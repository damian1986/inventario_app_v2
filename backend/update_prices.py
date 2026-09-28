import sys
import asyncio
import pandas as pd
from sqlalchemy.future import select
from sqlalchemy import update
from app.database import SessionLocal, engine
from app.models import Producto

def to_float(val):
    try:
        if pd.isna(val): return 0.0
        return float(val)
    except ValueError:
        return 0.0

async def main():
    print("Leyendo Excel...")
    try:
        df = pd.read_excel('precios.xlsx', sheet_name='almacen')
    except Exception as e:
        print("Error leyendo excel:", e)
        return

    sizes = df.iloc[1, 5:12].tolist()
    colors = df.iloc[1, 12:45].tolist()
    colors = [str(c).strip() for c in colors if str(c).strip() != 'nan']

    model_data = {}

    for i in range(2, 9):
        tipo = df.iloc[i, 2]
        edad = df.iloc[i, 3]
        peso = df.iloc[i, 4]
        if str(peso).strip() == 'nan':
            continue

        key = str(peso).strip() # Solo usamos el peso como clave, ej. C0200, D0300
        model_data[key] = {
            'prices': {}
        }

    for i in range(12, 21):
        if i >= len(df): continue
        peso = df.iloc[i, 4]
        if str(peso).strip() == 'nan': continue
        key = str(peso).strip()
        if key not in model_data: continue

        for j, size in enumerate(sizes):
            model_data[key]['prices'].setdefault(size, {})
            val_may = df.iloc[i, 5 + j]
            val_men = df.iloc[i, 13 + j]
            model_data[key]['prices'][size]['blancas_mayoreo'] = to_float(val_may)
            model_data[key]['prices'][size]['blancas_menudeo'] = to_float(val_men)

    for i in range(25, 35):
        if i >= len(df): continue
        peso = df.iloc[i, 4]
        if str(peso).strip() == 'nan': continue
        key = str(peso).strip()
        if key not in model_data: continue

        for j, size in enumerate(sizes):
            model_data[key]['prices'].setdefault(size, {})
            val_may = df.iloc[i, 5 + j]
            val_men = df.iloc[i, 13 + j]
            model_data[key]['prices'][size]['colores_mayoreo'] = to_float(val_may)
            model_data[key]['prices'][size]['colores_menudeo'] = to_float(val_men)

    size_names_rev = {
        'Extra Chica': 'XS',
        'Chica': 'S',
        'Mediana': 'M',
        'Grande': 'L',
        'X-Grande': 'XL',
        'XX-Grande': 'XXL',
        'XXX-Grande': 'XXXL',
        'XS': 'XS',
        'S': 'S',
        'M': 'M',
        'L': 'L',
        'XL': 'XL',
        'XXL': 'XXL',
        'XXXL': 'XXXL',
    }

    print("Conectando a la base de datos...")
    async with SessionLocal() as db:
        result = await db.execute(select(Producto))
        productos = result.scalars().all()
        
        updated_count = 0
        
        for p in productos:
            nombre = p.nombre
            if 'Playera' not in nombre and 'Sudadera' not in nombre:
                continue
                
            # Extraer Peso (C0200, N0300, etc)
            import re
            match_peso = re.search(r'\b([A-Z]\d{3,5})\b', nombre, re.IGNORECASE)
            if not match_peso:
                continue
            peso_key = match_peso.group(1).upper()
            
            if peso_key not in model_data:
                continue
                
            # Identificar color (blanco vs color)
            is_white = ('blanco' in nombre.lower() or 'blancas' in nombre.lower())
            
            # Identificar talla
            talla_encontrada = None
            # Ordenar por longitud descendente para que XXX-Grande se evalue antes que Grande
            for name in sorted(size_names_rev.keys(), key=len, reverse=True):
                short = size_names_rev[name]
                if re.search(rf'\b{name}\b', nombre, re.IGNORECASE) or nombre.endswith(name):
                    talla_encontrada = short
                    break
            
            if not talla_encontrada:
                continue
                
            price_data = model_data[peso_key]['prices'].get(talla_encontrada, {})
            
            nuevo_costo = price_data.get('blancas_mayoreo' if is_white else 'colores_mayoreo', 0.0)
            nuevo_menudeo = price_data.get('blancas_menudeo' if is_white else 'colores_menudeo', 0.0)
            
            if p.costo != nuevo_costo or p.costo_menudeo != nuevo_menudeo:
                p.costo = nuevo_costo
                p.costo_menudeo = nuevo_menudeo
                updated_count += 1
                
        if updated_count > 0:
            await db.commit()
            print(f"Se actualizaron exitosamente los precios de {updated_count} productos sin borrar el inventario existente.")
        else:
            print("No se encontraron productos para actualizar o ya estaban al día.")

if __name__ == "__main__":
    asyncio.run(main())
