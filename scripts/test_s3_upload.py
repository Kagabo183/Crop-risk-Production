import os
import sys
from pathlib import Path

def main():
    try:
        from app.services import storage
    except Exception as e:
        print('IMPORT_ERROR', e)
        sys.exit(2)

    # create a tiny dummy file to upload
    path = Path('data/test_upload_dummy.txt')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('dummy upload')

    key = f'satellite/test_auto_upload_{path.name}'
    try:
        uri = storage.upload_file(str(path), key)
        print('UPLOAD_OK', uri)
        # don't delete here; the process task controls deletion
        sys.exit(0)
    except Exception as e:
        print('UPLOAD_ERROR', type(e).__name__, e)
        sys.exit(3)

if __name__ == '__main__':
    main()
