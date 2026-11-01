from pathlib import Path
import json, shutil, hashlib, datetime
from PIL import Image, ImageDraw, ImageFont
D=Path(__file__).parent
records=json.loads((D/'generation-records.json').read_text())
(D/'originals').mkdir(exist_ok=True)
manifest={'tool':'image_gen.imagegen','model':'未暴露','model_version':'未暴露','generated_by':'native image generation; nine separate calls, seven selected and two rejected','reference_source':'Existing project references; public/pets/SOURCES.md. No new authorization claimed.','pet_references_reviewed':[f'public/pets/{pet}/lv{lv}.webp' for pet in ['westie','pig','chick'] for lv in [1,4,8]]+[f'public/pets/{pet}/lv4.webp' for pet in ['zodiac-rat','zodiac-ox','zodiac-snake']],'assets':[],'rejected':[]}
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
for r in records:
    suffix='-rejected' if r['status']!='selected' else ''
    src=Path(r['original_tool_path']); raw=D/'originals'/f"lv{r['level']}{suffix}.png"; shutil.copyfile(src,raw)
    im=Image.open(raw); a=im.getchannel('A') if 'A' in im.getbands() else None
    assert a is not None and a.getextrema()==(0,255), str(raw)
    hist=a.histogram()
    entry={**r,'original_path':str(raw.relative_to(D)),'tool':'image_gen.imagegen','model':'未暴露','model_version':'未暴露','generation_time_source':'started is actual tool invocation UTC timestamp; completed time not captured','original_dimensions':list(im.size),'original_sha256':sha(raw),'original_alpha':{'range':list(a.getextrema()),'transparent_pixels':hist[0],'opaque_pixels':hist[255],'partial_pixels':sum(hist[1:255])}}
    if suffix:
        manifest['rejected'].append(entry);continue
    # Size normalization only: preserve all original RGBA pixels, reduce whole canvas, pad transparently.
    resized=im.convert('RGBA').resize((448,448),Image.Resampling.LANCZOS)
    out=Image.new('RGBA',(512,512),(0,0,0,0));out.alpha_composite(resized,(32,32))
    path=D/f"lv{r['level']}.png";out.save(path)
    ah=out.getchannel('A').histogram()
    entry.update({'file':path.name,'absolute_path':str(path),'final_dimensions':[512,512],'sha256':sha(path),'processing':['Resize entire original RGBA canvas to 448x448 using Lanczos, preserving native alpha.','Center on 512x512 transparent canvas at offset 32,32. No keying, recoloring or generated shape edits.'],'final_alpha':{'range':list(out.getchannel('A').getextrema()),'transparent_pixels':ah[0],'opaque_pixels':ah[255],'partial_pixels':sum(ah[1:255]),'bbox':out.getchannel('A').getbbox(),'corners_transparent':all(out.getpixel(pt)[3]==0 for pt in [(0,0),(511,0),(0,511),(511,511)])}})
    manifest['assets'].append(entry)
assert len({x['sha256'] for x in manifest['assets']})==7
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18)
def preview(name,size,cell,rowh):
    p=Image.new('RGB',(cell*7,rowh*2))
    draw=ImageDraw.Draw(p)
    for row,(bg,fg) in enumerate([('#f8f5ef','#352946'),('#211c31','#eee7ff')]):
        draw.rectangle((0,row*rowh,p.width,(row+1)*rowh),fill=bg)
        for col,l in enumerate(range(2,9)):
            icon=Image.open(D/f'lv{l}.png').resize((size,size),Image.Resampling.LANCZOS)
            p.paste(icon,(col*cell+(cell-size)//2,row*rowh+12),icon)
            draw.text((col*cell+cell//2,row*rowh+size+20),f'Lv.{l}',font=font,fill=fg,anchor='mt')
    p.save(D/name)
preview('series-preview.png',176,190,222)
preview('preview-48px.png',48,90,96)
(D/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(D/'SHA256SUMS.txt').write_text('\n'.join(x['sha256']+'  '+x['file'] for x in manifest['assets'])+'\n')
print(json.dumps([{'file':x['file'],'size':x['final_dimensions'],'sha256':x['sha256'],'alpha':x['final_alpha']} for x in manifest['assets']],indent=2))
