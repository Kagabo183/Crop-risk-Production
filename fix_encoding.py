"""Fix garbled encoding in Dashboard.jsx — em-dash and middle-dot."""
import sys

path = r'c:\Users\Riziki\Crop-Prediction-Staging\web-app\src\pages\Dashboard.jsx'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find what sequences exist
import re
garbled = re.findall(r'[^\x00-\x7E\u2014\u00b7\u2013\u2026]+', content)
unique_garbled = set(''.join(garbled))
print("Non-ASCII codepoints found:", [(hex(ord(c)), c) for c in sorted(unique_garbled) if ord(c) > 0x7e])

# Strategy: detect the triple sequence â + € + " (0xE2, 0x20AC, 0x201D — Windows-1252 interp of UTF-8 em-dash bytes)
em_dash_sequences = [
    '\u00e2\u20ac\u201d',   # â€" (Windows-1252 interp of 0xE2 0x80 0x94)
    '\u00e2\u20ac\u201c',   # â€" (open quote variant)
    '\u00e2\u20ac\u2013',
]
middle_dot_sequences = [
    '\u00c2\u00b7',  # Â·
]

print("\nSearching for garbled em-dash...")
for seq in em_dash_sequences:
    count = content.count(seq)
    if count:
        print(f"  Found {count} of {repr(seq)}")
        content = content.replace(seq, '\u2014')

print("Searching for garbled middle-dot...")
for seq in middle_dot_sequences:
    count = content.count(seq)
    if count:
        print(f"  Found {count} of {repr(seq)}")
        content = content.replace(seq, '\u00b7')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("\nDone. Verifying...")
with open(path, 'r', encoding='utf-8') as f:
    c2 = f.read()
for seq in em_dash_sequences + middle_dot_sequences:
    if seq in c2:
        print(f"WARNING: still contains {repr(seq)}")
print("Verification complete. em-dashes remaining:", c2.count('\u2014'))
