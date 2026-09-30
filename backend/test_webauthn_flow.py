"""
Prueba end-to-end del backend de passkeys (WebAuthn) contra la API en marcha.

Simula un autenticador de software (llave EC P-256 + CBOR, igual que hace un
navegador con Windows Hello) y recorre el flujo real por HTTP:

  1. Registro de passkey (options → create → verify)
  2. Login con passkey como segundo factor
  3. Casos negativos (reto consumido, duplicado, llave ajena, contador de
     firmas que retrocede, credencial desconocida, origen no permitido,
     token sin 2fa_pending)
  4. Convivencia con TOTP (metodos_2fa = ["totp", "passkey"])
  5. Eliminación de la passkey

Crea un usuario de prueba temporal (contraseña aleatoria que nunca se imprime)
y lo elimina al final, junto con sus credenciales y registros de auditoría.

Uso (dentro del contenedor de la API):
  docker exec inventario_api python test_webauthn_flow.py
"""
import asyncio
import base64
import hashlib
import json
import os
import secrets
import sys
import urllib.error
import urllib.request

import cbor2
import pyotp
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

BASE = os.getenv("TEST_API_BASE", "http://localhost:8000")
RP_ID = os.getenv("WEBAUTHN_RP_ID", "localhost")
ORIGIN = os.getenv("WEBAUTHN_ORIGIN", "http://localhost:3000").split(",")[0].strip()
USER = "passkey_demo"
PASS = secrets.token_urlsafe(24)  # nunca se imprime

_fallos = 0


def check(nombre: str, condicion: bool, extra: str = ""):
    global _fallos
    if condicion:
        print(f"  [OK]    {nombre}")
    else:
        _fallos += 1
        print(f"  [FALLO] {nombre}" + (f"  →  {extra}" if extra else ""))


def b64url(datos: bytes) -> str:
    return base64.urlsafe_b64encode(datos).decode().rstrip("=")


def http(metodo: str, ruta: str, cuerpo=None, token=None):
    """Petición HTTP sencilla; devuelve (status, json)."""
    req = urllib.request.Request(BASE + ruta, method=metodo)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    try:
        with urllib.request.urlopen(req, data=datos, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        texto = e.read().decode() or "{}"
        try:
            return e.code, json.loads(texto)
        except json.JSONDecodeError:
            return e.code, {"detail": texto}


# ── Autenticador de software (lo que el navegador haría con Windows Hello) ──

class Autenticador:
    def __init__(self, rp_id: str, origin: str):
        self.priv = ec.generate_private_key(ec.SECP256R1())
        nums = self.priv.public_key().public_numbers()
        self.x = nums.x.to_bytes(32, "big")
        self.y = nums.y.to_bytes(32, "big")
        self.cred_id = secrets.token_bytes(32)
        self.sign_count = 0
        self.rp_id = rp_id
        self.origin = origin

    def _cose_key(self) -> bytes:
        # Mapa COSE de una llave EC2 P-256 (alg ES256)
        return cbor2.dumps({1: 2, 3: -7, -1: 1, -2: self.x, -3: self.y})

    def _auth_data(self, flags: int, conteo: int) -> bytes:
        return (
            hashlib.sha256(self.rp_id.encode()).digest()
            + bytes([flags])
            + conteo.to_bytes(4, "big")
        )

    def _client_data(self, tipo: str, reto_b64: str) -> bytes:
        return json.dumps({
            "type": tipo,
            "challenge": reto_b64,
            "origin": self.origin,
            "crossOrigin": False,
        }).encode()

    def crear(self, opciones: dict) -> dict:
        """Atestación para register/verify (fmt "none", UP+UV+AT)."""
        auth_data = (
            self._auth_data(0x45, 0)
            + b"\x00" * 16                                  # AAGUID
            + len(self.cred_id).to_bytes(2, "big")
            + self.cred_id
            + self._cose_key()
        )
        atestacion = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        cd = self._client_data("webauthn.create", opciones["challenge"])
        return {
            "id": b64url(self.cred_id),
            "rawId": b64url(self.cred_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64url(cd),
                "attestationObject": b64url(atestacion),
                "transports": ["internal"],
            },
            "clientExtensionResults": {},
        }

    def firmar(self, opciones: dict, conteo: int = None, cred_id_b64: str = None) -> dict:
        """Afirmación para login/verify (UP+UV, firma ECDSA-SHA256 en DER)."""
        if conteo is None:
            self.sign_count += 1
            conteo = self.sign_count
        cd = self._client_data("webauthn.get", opciones["challenge"])
        auth_data = self._auth_data(0x05, conteo)
        firma = self.priv.sign(auth_data + hashlib.sha256(cd).digest(), ec.ECDSA(hashes.SHA256()))
        cid = cred_id_b64 or b64url(self.cred_id)
        return {
            "id": cid,
            "rawId": cid,
            "type": "public-key",
            "response": {
                "clientDataJSON": b64url(cd),
                "authenticatorData": b64url(auth_data),
                "signature": b64url(firma),
                "userHandle": None,
            },
            "clientExtensionResults": {},
        }


# ── Preparación y limpieza de la BD ─────────────────────────────────────────

async def _limpiar_usuario():
    from sqlalchemy import delete, select
    from app.database import SessionLocal, engine
    from app import models
    try:
        async with SessionLocal() as db:
            q = await db.execute(select(models.Usuario).where(models.Usuario.username == USER))
            u = q.scalar_one_or_none()
            if not u:
                return
            await db.execute(delete(models.WebAuthnCredential).where(models.WebAuthnCredential.usuario_id == u.id))
            await db.execute(delete(models.AuditLog).where(models.AuditLog.usuario_id == u.id))
            await db.delete(u)
            await db.commit()
    finally:
        # Cada asyncio.run() usa un bucle nuevo; se cierra el pool para que
        # el siguiente bucle no herede conexiones del anterior (asyncpg).
        await engine.dispose()


async def _crear_usuario():
    from app.auth import hash_password
    from app.database import SessionLocal, engine
    from app import models
    try:
        async with SessionLocal() as db:
            u = models.Usuario(
                username=USER,
                nombre="Demo Passkeys",
                email=f"{USER}@prueba.local",
                password_hash=hash_password(PASS),
                rol="vendedor",
                activo=1,
            )
            db.add(u)
            await db.commit()
            await db.refresh(u)
            return u.id
    finally:
        await engine.dispose()


# ── Flujo de pruebas ────────────────────────────────────────────────────────

def flujo():
    print(f"\n== Prueba E2E de passkeys ==  rp_id={RP_ID}  origin={ORIGIN}\n")

    st, r = http("GET", "/health")
    check("/health responde", st == 200 and r.get("status") == "ok", f"status={st}")

    print("\n1) PREPARACIÓN: usuario de prueba limpio")
    asyncio.run(_limpiar_usuario())
    asyncio.run(_crear_usuario())

    print("\n2) LOGIN normal (sin ningún 2FA todavía)")
    st, r = http("POST", "/auth/login", {"username": USER, "password": PASS})
    check("login sin 2FA devuelve token final", st == 200 and bool(r.get("access_token")) and not r.get("requires_2fa"), f"status={st} {r}")
    token = r.get("access_token")

    print("\n3) REGISTRO de passkey")
    st, r = http("POST", "/auth/webauthn/register/verify", {"credential": {"id": "x"}}, token=token)
    check("register/verify sin reto previo → 400", st == 400, f"status={st} {r}")

    st, opciones = http("POST", "/auth/webauthn/register/options", token=token)
    check("register/options → 200 con challenge", st == 200 and "challenge" in opciones, f"status={st} {opciones}")
    check("rp.id es el configurado", opciones.get("rp", {}).get("id") == RP_ID, str(opciones.get("rp")))
    check("userVerification=required", opciones.get("authenticatorSelection", {}).get("userVerification") == "required", str(opciones.get("authenticatorSelection")))

    aut = Autenticador(RP_ID, ORIGIN)
    credencial = aut.crear(opciones)
    st, r = http("POST", "/auth/webauthn/register/verify", {"credential": credencial, "nombre": "Autenticador de prueba"}, token=token)
    check("register/verify → 201 con credencial", st == 201 and r.get("id"), f"status={st} {r}")
    cred_bd_id = r.get("id")

    st, r = http("POST", "/auth/webauthn/register/verify", {"credential": credencial}, token=token)
    check("register/verify repetido (reto consumido) → 400", st == 400, f"status={st} {r}")

    st, opciones_dup = http("POST", "/auth/webauthn/register/options", token=token)
    st, r = http("POST", "/auth/webauthn/register/verify", {"credential": aut.crear(opciones_dup)}, token=token)
    check("misma passkey dos veces (duplicado) → 400", st == 400, f"status={st} {r}")

    st, lista = http("GET", "/auth/webauthn/credenciales", token=token)
    check("credenciales → lista con 1", st == 200 and isinstance(lista, list) and len(lista) == 1, str(lista))

    print("\n4) LOGIN con passkey (segundo factor)")
    st, r = http("POST", "/auth/login", {"username": USER, "password": PASS})
    check("login ahora pide 2.º factor", st == 200 and r.get("requires_2fa") is True, f"status={st} {r}")
    check("metodos_2fa = ['passkey']", r.get("metodos_2fa") == ["passkey"], str(r.get("metodos_2fa")))
    temp = r.get("temp_token")

    st, opciones_login = http("POST", "/auth/webauthn/login/options", {"temp_token": temp})
    check("login/options → allowCredentials con la credencial", st == 200 and len(opciones_login.get("allowCredentials", [])) == 1, f"status={st} {opciones_login}")

    afirmacion = aut.firmar(opciones_login)
    st, r = http("POST", "/auth/webauthn/login/verify", {"temp_token": temp, "credential": afirmacion})
    check("login/verify → token final", st == 200 and bool(r.get("access_token")), f"status={st} {r}")
    token2 = r.get("access_token")

    st, yo = http("GET", "/auth/me", token=token2)
    check("/auth/me con el token final", st == 200 and yo.get("username") == USER, f"status={st} {yo}")

    print("\n5) CASOS NEGATIVOS")
    st, r = http("POST", "/auth/webauthn/login/verify", {"temp_token": temp, "credential": afirmacion})
    check("afirmación reutilizada (reto consumido) → 400", st == 400, f"status={st} {r}")

    st, r = http("POST", "/auth/login", {"username": USER, "password": PASS})
    temp_b = r.get("temp_token")

    st, op_b = http("POST", "/auth/webauthn/login/options", {"temp_token": temp_b})
    impostor = Autenticador(RP_ID, ORIGIN)
    st, r = http("POST", "/auth/webauthn/login/verify", {"temp_token": temp_b, "credential": impostor.firmar(op_b, cred_id_b64=b64url(aut.cred_id))})
    check("firma con llave ajena → 401", st == 401, f"status={st} {r}")

    st, op_c = http("POST", "/auth/webauthn/login/options", {"temp_token": temp_b})
    st, r = http("POST", "/auth/webauthn/login/verify", {"temp_token": temp_b, "credential": aut.firmar(op_c, conteo=1)})
    check("contador de firmas que retrocede → 401", st == 401, f"status={st} {r}")

    st, op_d = http("POST", "/auth/webauthn/login/options", {"temp_token": temp_b})
    desconocido = aut.firmar(op_d, conteo=99, cred_id_b64=b64url(secrets.token_bytes(32)))
    st, r = http("POST", "/auth/webauthn/login/verify", {"temp_token": temp_b, "credential": desconocido})
    check("credencial desconocida → 401", st == 401, f"status={st} {r}")

    st, op_e = http("POST", "/auth/webauthn/login/options", {"temp_token": temp_b})
    malo = Autenticador(RP_ID, "https://evil.example")
    afirmacion_mala = malo.firmar(op_e, cred_id_b64=b64url(aut.cred_id))
    st, r = http("POST", "/auth/webauthn/login/verify", {"temp_token": temp_b, "credential": afirmacion_mala})
    check("origen no permitido → 401", st == 401, f"status={st} {r}")

    st, r = http("POST", "/auth/webauthn/login/options", {"temp_token": token2})
    check("token final usado como temp_token → 401", st == 401, f"status={st} {r}")

    print("\n6) CONVIVENCIA CON TOTP")
    st, r = http("POST", "/auth/2fa/setup", token=token2)
    check("2fa/setup → secreto", st == 200 and bool(r.get("secret")), f"status={st} {r}")
    secreto = r.get("secret")

    st, r = http("POST", "/auth/2fa/enable", {"code": pyotp.TOTP(secreto).now()}, token=token2)
    check("2fa/enable → ok", st == 200, f"status={st} {r}")

    st, r = http("POST", "/auth/login", {"username": USER, "password": PASS})
    check("metodos_2fa = ['totp','passkey']", r.get("metodos_2fa") == ["totp", "passkey"], str(r.get("metodos_2fa")))
    temp_totp = r.get("temp_token")

    st, r = http("POST", "/auth/2fa/verify", {"code": pyotp.TOTP(secreto).now(), "temp_token": temp_totp})
    check("TOTP sigue funcionando → token final", st == 200 and bool(r.get("access_token")), f"status={st} {r}")
    token_totp = r.get("access_token")

    print("\n7) ELIMINACIÓN de la passkey")
    st, r = http("DELETE", f"/auth/webauthn/credenciales/{cred_bd_id}", token=token_totp)
    check("delete → ok", st == 200, f"status={st} {r}")

    st, r = http("DELETE", f"/auth/webauthn/credenciales/{cred_bd_id}", token=token_totp)
    check("delete repetido → 404", st == 404, f"status={st} {r}")

    st, lista = http("GET", "/auth/webauthn/credenciales", token=token_totp)
    check("credenciales queda vacía", lista == [], str(lista))

    st, r = http("POST", "/auth/login", {"username": USER, "password": PASS})
    check("metodos_2fa = ['totp'] tras eliminar la passkey", r.get("metodos_2fa") == ["totp"], str(r.get("metodos_2fa")))
    temp_final = r.get("temp_token")

    st, r = http("POST", "/auth/webauthn/login/options", {"temp_token": temp_final})
    check("login/options sin passkeys → 400", st == 400, f"status={st} {r}")


def main():
    try:
        flujo()
    finally:
        asyncio.run(_limpiar_usuario())
    if _fallos:
        print(f"\nRESULTADO: {_fallos} prueba(s) fallidas\n")
    else:
        print("\nRESULTADO: todas las pruebas pasaron\n")


if __name__ == "__main__":
    main()
    sys.exit(1 if _fallos else 0)
