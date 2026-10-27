import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W,H=1080,1920
out=sys.argv[1]; icon=sys.argv[2]
im=Image.new('RGBA',(W,H),(0,0,0,0))
# 아이콘(둥근 모서리)
S=250
ic=Image.open(icon).convert('RGBA').resize((S,S),Image.LANCZOS)
m=Image.new('L',(S,S),0); ImageDraw.Draw(m).rounded_rectangle((0,0,S,S),radius=56,fill=255)
ic.putalpha(Image.composite(ic.split()[3],m,m))
top=250
sh=Image.new('RGBA',(W,H),(0,0,0,0)); ImageDraw.Draw(sh).rounded_rectangle(((W-S)//2,top+10,(W+S)//2,top+S+10),radius=56,fill=(20,40,80,90))
im=Image.alpha_composite(im,sh.filter(ImageFilter.GaussianBlur(18)))
im.alpha_composite(ic,((W-S)//2,top))
GOTHIC='/System/Library/Fonts/AppleSDGothicNeo.ttc'
ko=ImageFont.truetype(GOTHIC,150,index=6)
en=ImageFont.truetype(GOTHIC,84,index=6)
sc=ImageFont.truetype('/System/Library/Fonts/Supplemental/SnellRoundhand.ttc',72,index=1)
NAVY=(18,42,92,255); ORANGE=(240,150,20,255)
def text(y,s,f,fill,glow=True):
  d=ImageDraw.Draw(im); w=d.textlength(s,font=f); x=(W-w)/2
  if glow:
    g=Image.new('RGBA',(W,H),(0,0,0,0)); ImageDraw.Draw(g).text((x,y),s,font=f,fill=(255,255,255,200),stroke_width=10,stroke_fill=(255,255,255,200))
    im.alpha_composite(g.filter(ImageFilter.GaussianBlur(12)))
  ImageDraw.Draw(im).text((x,y),s,font=f,fill=fill)
y=top+S+50
text(y,'듀티스왑',ko,NAVY); y+=175
text(y,'DutySwap',en,ORANGE); y+=120
text(y,'Swap and Enjoy Life',sc,NAVY)
im.save(out)
