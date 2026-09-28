import os
import sys
import time
import zipfile
import subprocess
from datetime import datetime
import shutil

# Configuración básica
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
VERSIONES_DIR = os.path.join(PROJECT_ROOT, "versiones_seguras")
DUMP_FILENAME = "base_de_datos_snapshot.sql"
ENV_FILE = os.path.join(PROJECT_ROOT, ".env")

# Carpetas y archivos a ignorar al comprimir
IGNORE_DIRS = {".git", "__pycache__", "venv", "node_modules", "versiones_seguras"}
IGNORE_EXTS = {".zip", ".pyc"}

def get_db_credentials():
    """Lee el .env para obtener el usuario y BD."""
    creds = {"db": "inventario_db", "user": "inventario"}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, "r") as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.strip().split("=", 1)
                    if k == "POSTGRES_DB": creds["db"] = v
                    elif k == "POSTGRES_USER": creds["user"] = v
    return creds

def run_command(cmd, shell=False, check=True):
    print(f"➜ Ejecutando: {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    res = subprocess.run(cmd, shell=shell, cwd=PROJECT_ROOT)
    if check and res.returncode != 0:
        print("❌ Error ejecutando el comando.")
        sys.exit(1)

def create_snapshot():
    os.makedirs(VERSIONES_DIR, exist_ok=True)
    creds = get_db_credentials()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_path = os.path.join(VERSIONES_DIR, f"Inventario_Snapshot_{timestamp}.zip")
    dump_path = os.path.join(PROJECT_ROOT, DUMP_FILENAME)

    print("\n📦 === CREANDO NUEVO SNAPSHOT ===")
    
    # 1. Extraer dump de la BD en caliente (antes de detener contenedores)
    print("1/4 Extrayendo base de datos...")
    dump_cmd = [
        "docker", "compose", "exec", "-T", "db", 
        "pg_dump", "-U", creds["user"], "-d", creds["db"], "--no-owner", "--no-privileges"
    ]
    try:
        with open(dump_path, "wb") as f:
            res = subprocess.run(dump_cmd, stdout=f, cwd=PROJECT_ROOT)
            if res.returncode != 0:
                print("⚠️  Advertencia: Hubo un problema extrayendo la BD (¿están apagados los contenedores?).")
                if os.path.exists(dump_path): os.remove(dump_path)
    except Exception as e:
        print(f"Error: {e}")

    # 2. Detener contenedores
    print("\n2/4 Deteniendo contenedores para asegurar consistencia...")
    run_command(["docker", "compose", "stop"])

    # 3. Empaquetar en ZIP
    print(f"\n3/4 Comprimiendo archivos en {os.path.basename(zip_path)}...")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(PROJECT_ROOT):
            # Filtrar carpetas ignoradas (modificando dirs in situ)
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            
            for file in files:
                ext = os.path.splitext(file)[1]
                if ext in IGNORE_EXTS: continue
                
                abs_file = os.path.join(root, file)
                rel_file = os.path.relpath(abs_file, PROJECT_ROOT)
                # No meterse a sí mismo ni otros basuras si se escapó
                if rel_file.startswith("versiones_seguras"): continue
                
                zipf.write(abs_file, rel_file)

    # 4. Limpieza y Re-arranque
    print("\n4/4 Limpiando y levantando la aplicación...")
    if os.path.exists(dump_path):
        os.remove(dump_path)
    run_command(["docker", "compose", "up", "-d"])

    print("\n✅ ¡SNAPSHOT CREADO CON ÉXITO!")
    print(f"📁 Ruta: {zip_path}")
    print("💡 Puedes llevarte este archivo ZIP a otra computadora o guardarlo como versión segura.\n")


def restore_snapshot(zip_file=None):
    if not zip_file:
        # Buscar el ZIP más reciente
        if not os.path.exists(VERSIONES_DIR):
            print("❌ No existe la carpeta de versiones_seguras.")
            sys.exit(1)
        zips = [os.path.join(VERSIONES_DIR, f) for f in os.listdir(VERSIONES_DIR) if f.endswith(".zip")]
        if not zips:
            print("❌ No se encontraron snapshots.")
            sys.exit(1)
        zip_file = max(zips, key=os.path.getmtime)

    print("\n♻️ === RESTAURANDO SNAPSHOT ===")
    print(f"📦 Usando archivo: {os.path.basename(zip_file)}")
    
    confirm = input("⚠️  ADVERTENCIA: Esto SOBRESCRIBIRÁ tu código actual y limpiará TODA la base de datos de Docker.\n¿Estás completamente seguro de continuar? (s/N): ")
    if confirm.lower() != 's':
        print("Restauración cancelada.")
        sys.exit(0)

    # 1. Detener contenedores y borrar el volumen de base de datos actual!
    print("\n1/5 Apagando contenedores locales...")
    run_command(["docker", "compose", "down", "-v"]) # -v borra los volumenes incluyendo la DB vieja!

    # 2. Descomprimir el snapshot encima del código actual
    print("\n2/5 Extrayendo código (sobrescribiendo)...")
    with zipfile.ZipFile(zip_file, "r") as zipf:
        zipf.extractall(PROJECT_ROOT)
    
    # 3. Arrancar los contenedores base (la nueva BD limpia)
    print("\n3/5 Levantando la aplicación con BD limpia...")
    run_command(["docker", "compose", "up", "-d"])
    
    # 4. Restaurar la base de datos desde el SQL
    dump_path = os.path.join(PROJECT_ROOT, DUMP_FILENAME)
    if os.path.exists(dump_path):
        print("\n4/5 Esperando que la base de datos esté lista (5 seg)...")
        time.sleep(5) # Dar tiempo a Postgres a iniciar
        creds = get_db_credentials()
        
        print("Restaurando datos SQL...")
        # Corremos el restore inyectando el SQL
        restore_cmd = [
            "docker", "compose", "exec", "-T", "db", 
            "psql", "-U", creds["user"], "-d", creds["db"]
        ]
        try:
            with open(dump_path, "rb") as f:
                res = subprocess.run(restore_cmd, stdin=f, stdout=subprocess.DEVNULL, cwd=PROJECT_ROOT)
                if res.returncode == 0:
                    print("✅ Base de datos restaurada correctamente.")
                else:
                    print("⚠️ Error al restaurar el archivo SQL.")
        except Exception as e:
            print(f"Error: {e}")
        
        # Limpiar
        os.remove(dump_path)
    else:
        print("\n4/5 No se encontró archivo SQL en el backup. Se inició la aplicación con BD en blanco.")

    print("\n🚀 ¡RESTAURACIÓN FINALIZADA CON ÉXITO!")
    print("El sistema debería estar funcionando exactamente como cuando creaste el snapshot.\n")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "restore":
        archive = sys.argv[2] if len(sys.argv) > 2 else None
        restore_snapshot(archive)
    else:
        create_snapshot()
