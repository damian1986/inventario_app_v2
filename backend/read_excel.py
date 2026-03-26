import sys
try:
    import pandas as pd
except ImportError:
    print("Pandas not installed. Please install it.")
    sys.exit(1)

xl = pd.ExcelFile('precios.xlsx')
for s in xl.sheet_names:
    print(f"\n=== SHEET: {s} ===")
    df = pd.read_excel('precios.xlsx', sheet_name=s)
    print(df.to_markdown())
