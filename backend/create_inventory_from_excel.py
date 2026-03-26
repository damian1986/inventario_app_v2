import sys
import asyncio
import pandas as pd
from sqlalchemy.future import select
from sqlalchemy import delete
from app.database import SessionLocal, engine
from app.models import Producto, Movimiento

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
        if str(peso).strip() == 'nan': continue
        
        key = f"{edad}_{peso}"
        model_data[key] = {
            'baseName': f"{str(tipo).strip()} {str(edad).strip()}",
            'peso': str(peso).strip(),
            'sizes_avail': {},
            'colors_avail': [],
            'prices': {}
        }
        
        for j, size in enumerate(sizes):
            val = str(df.iloc[i, 5+j]).strip().upper()
            if val == 'SI':
                model_data[key]['sizes_avail'][size] = True
                
        for j, color in enumerate(colors):
            val = str(df.iloc[i, 12+j]).strip().upper()
            if val == 'SI':
                model_data[key]['colors_avail'].append(color.strip())

    for i in range(12, 21): # broader range
        if i >= len(df): continue
        edad = df.iloc[i, 3]
        peso = df.iloc[i, 4]
        if str(peso).strip() == 'nan': continue
        key = f"{edad}_{peso}"
        if key not in model_data: continue
        
        for j, size in enumerate(sizes):
            model_data[key]['prices'].setdefault(size, {})
            val_may = df.iloc[i, 5+j]
            val_men = df.iloc[i, 13+j]
            
            model_data[key]['prices'][size]['blancas_mayoreo'] = to_float(val_may)
            model_data[key]['prices'][size]['blancas_menudeo'] = to_float(val_men)

    for i in range(25, 35): # broader range
        if i >= len(df): continue
        edad = df.iloc[i, 3]
        peso = df.iloc[i, 4]
        if str(peso).strip() == 'nan': continue
        key = f"{edad}_{peso}"
        if key not in model_data: continue
        
        for j, size in enumerate(sizes):
            model_data[key]['prices'].setdefault(size, {})
            val_may = df.iloc[i, 5+j]
            val_men = df.iloc[i, 13+j]
            
            model_data[key]['prices'][size]['colores_mayoreo'] = to_float(val_may)
            model_data[key]['prices'][size]['colores_menudeo'] = to_float(val_men)

    productos_to_insert = []
    
    edad_map = {
        'Caballero': 'C',
        'Dama': 'D',
        'Joven': 'J',
        'Niño': 'N',
        'Bebé': 'B'
    }
    
    size_names = {
        'XS': 'Extra Chica',
        'S': 'Chica',
        'M': 'Mediana',
        'L': 'Grande',
        'XL': 'Extragrande',
        'XXL': 'Extra Extra Grande',
        'XXXL': 'Extra Extra Extra Grande'
    }
    
    for key, data in model_data.items():
        for color in data['colors_avail']: # type: ignore
            for size in data['sizes_avail']: # type: ignore
                is_white = ('blanco' in color.lower() or 'blancas' in color.lower())
                price_data = data['prices'].get(size, {}) # type: ignore
                
                costo = price_data.get('blancas_mayoreo' if is_white else 'colores_mayoreo', 0)
                # El usuario pidió que el precio de venta esté vacío (0) porque varía por canal
                precio = 0
                
                prenda_char = "P"
                edad_char = edad_map.get(str(data['baseName']).split(' ')[-1], "X") # type: ignore
                peso_code = str(data['peso']) # type: ignore
                peso_digits = peso_code[-4:] if len(peso_code) >= 4 else "0000"
                color_clean = str(color).upper().replace(" ", "")
                size_clean = str(size).upper()
                size_full = size_names.get(size_clean, size_clean)
                
                sku = f"{prenda_char}{edad_char}{peso_digits}{color_clean}-{size_clean}"
                
                # Frontend relies on base name to group correctly, now split by '>'
                # e.g., "Playera Caballero Peso C0200>Negro>Chica"
                full_name = f"{data['baseName']} Peso {peso_code}>{color}>{size_full}"
                
                # Build hierarchical category e.g., "Playera › Caballero"
                tipo_str = str(data['baseName']).split(' ')[0]
                edad_str = str(data['baseName']).split(' ')[-1]
                categoria_jerarquica = f"{tipo_str} › {edad_str}"
                
                productos_to_insert.append(Producto(
                    sku=sku,
                    nombre=full_name,
                    venta=precio,
                    costo=costo,
                    qty=0,
                    min_stock=1,
                    categoria=categoria_jerarquica
                ))
                
    print(f"Calculated {len(productos_to_insert)} products to insert.")
    
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
