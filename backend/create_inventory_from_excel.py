import sys
import asyncio
import pandas as pd
from sqlalchemy.future import select
from sqlalchemy import delete
from app.database import SessionLocal, engine
from app.models import Producto, Movimiento
from app.sku import generar_sku


def to_float(val):
    try:
        if pd.isna(val): return 0.0
        return float(val)
    except ValueError:
        return 0.0


async def main():
    print("Reading Excel...")
    df = pd.read_excel('precios.xlsx', sheet_name='almacen')

    sizes = df.iloc[1, 5:12].tolist()
    colors = df.iloc[1, 12:45].tolist()
    colors = [str(c).strip() for c in colors if str(c).strip() != 'nan']

    print(f"Parsed {len(sizes)} sizes and {len(colors)} colors from Excel.")

    model_data = {}

    for i in range(2, 9):
        tipo = df.iloc[i, 2]
        edad = df.iloc[i, 3]
        peso = df.iloc[i, 4]
        if str(peso).strip() == 'nan':
            continue

        key = f"{edad}_{peso}"
        model_data[key] = {
            'baseName': f"{str(tipo).strip()} {str(edad).strip()}",
            'peso': str(peso).strip(),
            'sizes_avail': {},
            'colors_avail': [],
            'prices': {}
        }

        for j, size in enumerate(sizes):
            val = str(df.iloc[i, 5 + j]).strip().upper()
            if val == 'SI':
                model_data[key]['sizes_avail'][size] = True

        for j, color in enumerate(colors):
            val = str(df.iloc[i, 12 + j]).strip().upper()
            if val == 'SI':
                model_data[key]['colors_avail'].append(color.strip())

    for i in range(12, 21):
        if i >= len(df): continue
        edad = df.iloc[i, 3]
        peso = df.iloc[i, 4]
        if str(peso).strip() == 'nan': continue
        key = f"{edad}_{peso}"
        if key not in model_data: continue

        for j, size in enumerate(sizes):
            model_data[key]['prices'].setdefault(size, {})
            val_may = df.iloc[i, 5 + j]
            val_men = df.iloc[i, 13 + j]
            model_data[key]['prices'][size]['blancas_mayoreo'] = to_float(val_may)
            model_data[key]['prices'][size]['blancas_menudeo'] = to_float(val_men)

    for i in range(25, 35):
        if i >= len(df): continue
        edad = df.iloc[i, 3]
        peso = df.iloc[i, 4]
        if str(peso).strip() == 'nan': continue
        key = f"{edad}_{peso}"
        if key not in model_data: continue

        for j, size in enumerate(sizes):
            model_data[key]['prices'].setdefault(size, {})
            val_may = df.iloc[i, 5 + j]
            val_men = df.iloc[i, 13 + j]
            model_data[key]['prices'][size]['colores_mayoreo'] = to_float(val_may)
            model_data[key]['prices'][size]['colores_menudeo'] = to_float(val_men)

    # Mapa de segmento (edad) → keyword que entiende generar_sku
    edad_a_keyword = {
        'Caballero': 'Caballero',
        'Dama':      'Dama',
        'Joven':     'Joven',
        'Niño':      'Nino',
        'Bebé':      'Bebe',
    }

    size_names = {
        'XS':   'Extra Chica',
        'S':    'Chica',
        'M':    'Mediana',
        'L':    'Grande',
        'XL':   'Extragrande',
        'XXL':  'Extra Extra Grande',
        'XXXL': 'Extra Extra Extra Grande',
    }

    # Contador por categoría para generar_sku (solo se usa en categorías no-Playera)
    contadores: dict = {}

    productos_to_insert = []

    for key, data in model_data.items():
        for color in data['colors_avail']:
            for size in data['sizes_avail']:
                is_white = ('blanco' in color.lower() or 'blancas' in color.lower())
                price_data = data['prices'].get(size, {})

                costo  = price_data.get('blancas_mayoreo' if is_white else 'colores_mayoreo', 0)
                precio = 0  # precio de venta vacío; varía por canal

                # Construir nombre completo con el keyword de segmento incrustado
                # Ejemplo: "Playera Caballero C300 Negro"
                base_parts    = str(data['baseName']).split(' ')   # ["Playera", "Caballero"]
                tipo_str      = base_parts[0]                       # "Playera"
                edad_str      = base_parts[-1]                      # "Caballero"
                keyword_edad  = edad_a_keyword.get(edad_str, edad_str)
                color_clean   = str(color).strip()
                nombre_sku    = f"{tipo_str} {keyword_edad} {color_clean}"

                categoria_jerarquica = f"{tipo_str} › {edad_str}"

                contadores[categoria_jerarquica] = contadores.get(categoria_jerarquica, 0) + 1

                # Generar SKU usando el módulo centralizado
                # Para playeras pasamos la talla como variante para que se detecte
                sku = generar_sku(
                    categoria="Playeras",
                    nombre=nombre_sku,
                    variantes=[str(size).upper()],
                    contador=contadores[categoria_jerarquica],
                )

                size_full = size_names.get(str(size).upper(), str(size).upper())

                # Nombre completo del producto para mostrar en frontend
                full_name = f"{data['baseName']} {data['peso']}>{color}>{size_full}"

                productos_to_insert.append(Producto(
                    sku=sku,
                    nombre=full_name,
                    venta=precio,
                    costo=costo,
                    qty=0,
                    min_stock=1,
                    categoria=categoria_jerarquica,
                ))

    print(f"Calculated {len(productos_to_insert)} products to insert.")

    # Ejemplo de los primeros 3 SKUs generados para verificación
    for p in productos_to_insert[:3]:
        print(f"  SKU: {p.sku}  |  {p.nombre}")

    print("Connecting to Async DB...")
    async with SessionLocal() as db:
        print("Clearing Movimientos...")
        await db.execute(delete(Movimiento))
        print("Clearing Productos...")
        await db.execute(delete(Producto))

        print("Inserting new products...")
        db.add_all(productos_to_insert)
        await db.commit()

    print("Done! Database successfully populated.")


if __name__ == "__main__":
    asyncio.run(main())
