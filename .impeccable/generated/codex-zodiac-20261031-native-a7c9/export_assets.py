from PIL import Image, ImageChops, ImageStat
from pathlib import Path
import json, hashlib, shutil, datetime
import numpy as np

root=Path(__file__).resolve().parent
record=json.loads((root/'generation-record.json').read_text())
rows={'zodiac-rat':414,'zodiac-ox':390,'zodiac-snake':414}
items=[]
for gen in record['generations']:
    name=gen['animal']
    src=Path(gen['source_file'])
    im=Image.open(src).convert('RGB')
    sheet=root/(name+'-source.png')
    shutil.copy2(src,sheet)
    gen['source_dimensions']=list(im.size)
    gen['source_sha256']=hashlib.sha256(sheet.read_bytes()).hexdigest()
    gen['generation_file_time']=datetime.datetime.fromtimestamp(src.stat().st_mtime,datetime.timezone.utc).isoformat()
    preview=Image.new('RGB',(1120,560),'white')
    for idx in range(8):
        col=idx%4
        row=idx//4
        bounds=(round(col*im.width/4),0 if row==0 else rows[name],round((col+1)*im.width/4),rows[name] if row==0 else im.height)
        if name == "zodiac-rat" and row == 0:
            edges=[0,443,887,1380,1774]
            bounds=(edges[col],bounds[1],edges[col+1],bounds[3])
        cell=im.crop(bounds)
        a=np.asarray(cell).astype(int)
        mask=(a.min(axis=2)<220)
        yy,xx=np.where(mask)
        # Retain a generous margin around all rendered animal pixels and shadows.
        bbox=(max(0,int(xx.min())-12),max(0,int(yy.min())-12),min(cell.width,int(xx.max())+13),min(cell.height,int(yy.max())+13))
        content=cell.crop(bbox)
        canvas=Image.new('RGB',(560,560),'white')
        assert content.width<=520 and content.height<=520
        canvas.paste(content,((560-content.width)//2,(560-content.height)//2))
        path=root/name/('lv'+str(idx+1)+'.png')
        canvas.save(path)
        preview.paste(canvas.resize((280,280),Image.Resampling.LANCZOS),(col*280,row*280))
        items.append({'animal':name,'level':idx+1,'file':str(path),'dimensions':[560,560],'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'pixel_sha256':hashlib.sha256(canvas.tobytes()).hexdigest(),'source_sheet':str(sheet),'source_cell_box':bounds,'content_crop_within_cell':bbox,'processing':'Crop independent AI-generated panel; center on white 560x560 canvas without rescaling animal pixels.'})
    preview.save(root/(name+'-preview.png'))
record['files']=items
record['verification']={'expected_count':24,'actual_count':len(items),'unique_file_sha256':len({i['sha256'] for i in items}),'unique_pixel_sha256':len({i['pixel_sha256'] for i in items}),'all_dimensions':[560,560],'background':'white','actual_model':'undisclosed by native tool'}
record['reference_sha256']={p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in record['all_inspected_references']}
(root/'manifest.json').write_text(json.dumps(record,ensure_ascii=False,indent=2))
(root/'SHA256SUMS').write_text(''.join(i['sha256']+'  '+str(Path(i['file']).relative_to(root))+'\n' for i in items))
assert len(items)==len({i['sha256'] for i in items})==24
for item in items:
    with Image.open(item['file']) as check:
        check.verify()
print(json.dumps(record['verification'],ensure_ascii=False))

