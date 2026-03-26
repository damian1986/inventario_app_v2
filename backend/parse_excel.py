import pandas as pd
import json

df = pd.read_excel('precios.xlsx', sheet_name='almacen', header=None)

# Extract headers
sizes = df.iloc[2, 6:13].tolist() # Indices 6 to 12
colors = df.iloc[2, 13:46].tolist() # Indices 13 to 45

# Clean nans in colors if any
colors = [c for c in colors if str(c) != 'nan']

# Mapping structs
model_data = {}

# Parse availability (Rows 3 to 9 in zero-indexed? Wait, in txt:
# line 7: | 2 | nan | nan | Playera | Caballero | C0200...
# So row index 2 in dataframe is the first data row. Wait, sizes/colors headers are in index 1.
sizes = df.iloc[1, 6:13].tolist()
colors = df.iloc[1, 13:46].tolist()
colors = [c for c in colors if str(c) != 'nan']

print("Sizes:", sizes)
print("Colors:", colors)

# Rows 2 to 8 are availability
for i in range(2, 9):
    tipo = df.iloc[i, 3]
    edad = df.iloc[i, 4]
    peso = df.iloc[i, 5]
    if str(peso) == 'nan': continue
    
    key = f"{edad}_{peso}"
    model_data[key] = {
        'tipo': tipo,
        'edad': edad,
        'peso': peso,
        'sizes_avail': {},
        'colors_avail': [],
        'prices': {}
    }
    
    # sizes
    for j, size in enumerate(sizes):
        val = str(df.iloc[i, 6+j]).strip().upper()
        if val == 'SI':
            model_data[key]['sizes_avail'][size] = True
            
    # colors
    for j, color in enumerate(colors):
        val = str(df.iloc[i, 13+j]).strip().upper()
        if val == 'SI':
            model_data[key]['colors_avail'].append(color)

# Prices Blancas: Rows 13 to 19 
for i in range(13, 20):
    edad = df.iloc[i, 4]
    peso = df.iloc[i, 5]
    if str(peso) == 'nan': continue
    key = f"{edad}_{peso}"
    if key not in model_data: continue
    
    for j, size in enumerate(sizes):
        model_data[key]['prices'].setdefault(size, {})
        model_data[key]['prices'][size]['blancas_mayoreo'] = df.iloc[i, 6+j]
        model_data[key]['prices'][size]['blancas_menudeo'] = df.iloc[i, 15+j] # wait, menudeo XS is col 15?
        
# Prices Colores: Rows 26 to 32
for i in range(26, 33):
    edad = df.iloc[i, 4]
    peso = df.iloc[i, 5]
    if str(peso) == 'nan': continue
    key = f"{edad}_{peso}"
    if key not in model_data: continue
    
    for j, size in enumerate(sizes):
        model_data[key]['prices'].setdefault(size, {})
        model_data[key]['prices'][size]['colores_mayoreo'] = df.iloc[i, 6+j]
        model_data[key]['prices'][size]['colores_menudeo'] = df.iloc[i, 15+j]

# Generate variations list
variations = []
for key, data in model_data.items():
    for color in data['colors_avail']:
        for size in data['sizes_avail']:
            is_white = (color.strip().upper() == 'BLANCO')
            price_data = data['prices'].get(size, {})
            
            costo = price_data.get('blancas_mayoreo' if is_white else 'colores_mayoreo', 0)
            precio = price_data.get('blancas_menudeo' if is_white else 'colores_menudeo', 0)
            
            variations.append({
                'tipo': data['tipo'],
                'edad': data['edad'],
                'peso': data['peso'],
                'color': color,
                'talla': size,
                'costo_compra': costo,
                'precio_venta': precio
            })

print(f"Generated {len(variations)} variations.")
with open('variations.json', 'w', encoding='utf-8') as f:
    json.dump(variations[:5], f, ensure_ascii=False, indent=2)
print("Example dumped to variations.json")
