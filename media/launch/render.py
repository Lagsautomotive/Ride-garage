#!/usr/bin/env python3
"""Render Ride Garage's 25-second vertical launch promo from real app captures."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps
import json, math, subprocess, wave
import numpy as np

BASE=Path(__file__).resolve().parent
OUT=BASE/"exports"
WORK=BASE/".work"
OUT.mkdir(parents=True,exist_ok=True)
WORK.mkdir(parents=True,exist_ok=True)
W,H,FPS=1080,1920,30
GOLD=(223,189,123)
WHITE=(247,243,235)
MUTED=(193,190,181)
FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def run(args):
    subprocess.run([str(a) for a in args],check=True)

def font(size,bold=False):
    return ImageFont.truetype(BOLD if bold else FONT,size)

def text(im,xy,value,size=44,color=WHITE,bold=False,maxw=None):
    d=ImageDraw.Draw(im)
    f=font(size,bold)
    if maxw:
        while d.textbbox((0,0),value,font=f)[2]>maxw and size>18:
            size-=1
            f=font(size,bold)
    d.text(xy,value,font=f,fill=color,stroke_width=0)

def centered(im,y,value,size=44,color=WHITE,bold=False,maxw=880):
    f=font(size,bold)
    d=ImageDraw.Draw(im)
    while d.textbbox((0,0),value,font=f)[2]>maxw and size>18:
        size-=1
        f=font(size,bold)
    width=d.textbbox((0,0),value,font=f)[2]
    d.text(((W-width)//2,y),value,font=f,fill=color)

hero=Image.open(BASE/"hero.png").convert("RGB")
photo=ImageOps.fit(hero,(W,H),method=Image.Resampling.LANCZOS)
yy,xx=np.mgrid[0:H,0:W]
glow=np.exp(-(((xx-1040)/980)**2+((yy-520)/1050)**2))*16
field=np.zeros((H,W,3),dtype=np.uint8)
for ch,b in enumerate((9,11,12)):
    field[:,:,ch]=np.clip(b+glow*(1.0 if ch==0 else .73 if ch==1 else .37),0,255)
flat=Image.fromarray(field,"RGB")

def background(use_photo=False):
    if not use_photo:
        im=flat.copy()
        d=ImageDraw.Draw(im)
        for x in range(-900,1700,180):
            d.line((x,0,x+900,H),fill=(27,27,25),width=1)
        return im
    im=photo.convert("RGBA")
    shade=Image.new("RGBA",(W,H))
    a=np.asarray(shade).copy()
    alpha=np.where(yy<670,190-(yy/670)*70,45+(yy/H)*30)
    a[:,:,3]=np.uint8(np.clip(alpha,0,255))
    return Image.alpha_composite(im,Image.fromarray(a,"RGBA")).convert("RGB")

def brand(im,y=166,center=False):
    x=90
    if center:
        x=290
    d=ImageDraw.Draw(im)
    pts=[(x+26,y),(x+52,y+15),(x+52,y+49),(x+26,y+67),(x,y+49),(x,y+15),(x+26,y)]
    d.line(pts,fill=GOLD,width=3,joint="curve")
    d.line((x,y+15,x+26,y+31,x+52,y+15),fill=GOLD,width=3)
    d.line((x+26,y+31,x+26,y+67),fill=GOLD,width=3)
    text(im,(x+74,y+10),"RIDE GARAGE",32,WHITE,True,maxw=700)

def phone(im,name,x,y,width=520):
    screen=Image.open(BASE/"captures"/(name+".png")).convert("RGB")
    height=round(width*screen.height/screen.width)
    screen=screen.resize((width,height),Image.Resampling.LANCZOS)
    mask=Image.new("L",screen.size,0)
    ImageDraw.Draw(mask).rounded_rectangle((0,0,width-1,height-1),radius=30,fill=255)
    shadow=Image.new("RGBA",im.size)
    sd=ImageDraw.Draw(shadow)
    sd.rounded_rectangle((x-14,y-8,x+width+18,y+height+26),radius=47,fill=(0,0,0,210))
    shadow=shadow.filter(ImageFilter.GaussianBlur(20))
    im.paste(shadow,(0,0),shadow)
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((x-12,y-12,x+width+12,y+height+12),radius=43,fill=(8,9,10),outline=(105,94,75),width=3)
    im.paste(screen,(x,y),mask)

def heading(im,first,second,sub):
    brand(im)
    text(im,(88,320),first,92,WHITE,True,maxw=880)
    text(im,(88,430),second,92,GOLD,True,maxw=880)
    text(im,(92,562),sub,32,MUTED,maxw=880)

plates=[]
im=background(True)
brand(im)
text(im,(88,340),"YOUR BIKE.",106,WHITE,True,maxw=890)
text(im,(88,465),"YOUR STORY.",106,GOLD,True,maxw=890)
text(im,(92,1420),"INTRODUCING",29,GOLD,True)
text(im,(88,1470),"RIDE GARAGE",70,WHITE,True,maxw=900)
plates.append(im)

im=background()
heading(im,"BUILD YOUR","GARAGE.","Photos. Mods. Every detail.")
text(im,(278,616),"DEMO GARAGE",22,GOLD,True)
phone(im,"garage",270,674,520)
plates.append(im)

im=background()
heading(im,"RECORD YOUR","RIDES.","Record your route with the app open.")
text(im,(278,616),"DEMO RIDE",22,GOLD,True)
phone(im,"rides",270,674,520)
plates.append(im)

im=background()
heading(im,"CARE FOR","YOUR RIDE.","Service records + fuel logs.")
text(im,(112,653),"SERVICE",24,GOLD,True)
phone(im,"service",108,711,398)
text(im,(560,788),"FUEL",24,GOLD,True)
phone(im,"fuel",558,846,398)
text(im,(92,1730),"Demo records shown",22,MUTED)
plates.append(im)

im=background(True)
overlay=Image.new("RGB",(W,H),(8,10,11))
im=Image.blend(im,overlay,.65)
brand(im,230,True)
centered(im,430,"RIDE",148,WHITE,True)
centered(im,605,"GARAGE",148,GOLD,True)
centered(im,865,"Build it. Ride it. Remember it.",37,WHITE)
d=ImageDraw.Draw(im)
d.rounded_rectangle((168,1040,912,1162),radius=61,fill=GOLD)
centered(im,1070,"TRY THE PUBLIC BETA",40,(17,18,15),True)
centered(im,1230,"Free to try. Made for riders.",36,WHITE)
centered(im,1360,"lagsautomotive.github.io/Ride-garage/",29,GOLD,maxw=900)
plates.append(im)

durations=[3,5,5,5,7]
for i,plate in enumerate(plates):
    plate.save(WORK/("scene-%d.png"%i))
plates[0].save(OUT/"ride-garage-cover-1080x1920.png")
feed=ImageOps.fit(photo,(1080,1350),method=Image.Resampling.LANCZOS)
feed=Image.blend(feed,Image.new("RGB",feed.size,(6,8,9)),.38)
d=ImageDraw.Draw(feed)
d.text((82,110),"RIDE GARAGE",font=font(54,True),fill=GOLD)
d.text((78,270),"YOUR BIKE.",font=font(88,True),fill=WHITE)
d.text((78,378),"YOUR STORY.",font=font(88,True),fill=GOLD)
d.text((82,1140),"Explore the public beta",font=font(40,True),fill=WHITE)
feed.save(OUT/"ride-garage-cover-instagram-1080x1350.png")
board=Image.new("RGB",(1080,444),(10,12,13))
for i,plate in enumerate(plates):
    board.paste(plate.resize((216,384),Image.Resampling.LANCZOS),(i*216,0))
    ImageDraw.Draw(board).text((i*216+14,402),"%d-%ds"%(sum(durations[:i]),sum(durations[:i+1])),font=font(22),fill=GOLD)
board.save(OUT/"ride-garage-storyboard.png")

# Original instrumental: no downloaded recordings or third-party music.
rate=44100
duration=25
n=rate*duration
mix=np.zeros((n,2),np.float64)
rng=np.random.default_rng(20261015)
beat=60/112
def add(sound,start,level=1,pan=0):
    offset=round(start*rate)
    if offset>=n:return
    sound=np.asarray(sound)
    if offset<0:sound=sound[-offset:];offset=0
    count=min(len(sound),n-offset)
    if count<=0:return
    mix[offset:offset+count,0]+=sound[:count]*level*(1-pan*.35)
    mix[offset:offset+count,1]+=sound[:count]*level*(1+pan*.35)
def hz(midi):return 440*2**((midi-69)/12)
roots=[38,34,41,36]
for k in range(math.ceil(duration/beat)):
    at=k*beat
    tt=np.arange(round(.43*rate))/rate
    phase=2*np.pi*(44*tt+58*(1-np.exp(-tt*20))/20)
    add(np.sin(phase)*np.exp(-tt*12),at,.48)
    root=roots[(k//4)%4]
    add((np.sin(2*np.pi*hz(root)*tt)+.18*np.sin(4*np.pi*hz(root)*tt))*np.exp(-tt*5),at,.20)
    if k%4 in [1,3]:
        st=np.arange(round(.16*rate))/rate
        noise=rng.normal(0,1,len(st))
        add((noise-np.roll(noise,1))*.5*np.exp(-st*29),at,.095)
    for off in [0,.5]:
        ht=np.arange(round(.08*rate))/rate
        noise=rng.normal(0,1,len(ht))
        add((noise-np.roll(noise,1))*np.exp(-ht*60),at+off*beat,.025,(-1)**k*.4)
for k in range(math.ceil(duration/(beat/2))):
    root=roots[(k//8)%4]
    intervals=[0,3,7,12] if (k//8)%4==0 else [0,4,7,12]
    midi=root+24+intervals[k%4]
    tt=np.arange(round(.42*rate))/rate
    note=(np.sin(2*np.pi*hz(midi)*tt)+.15*np.sin(4*np.pi*hz(midi)*tt))*np.exp(-tt*12)*(1-np.exp(-tt*120))
    add(note,k*beat/2,.075,(-1)**k*.55)
for bar in range(math.ceil(duration/(beat*4))):
    root=roots[bar%4]+12
    tt=np.arange(round(beat*4*rate))/rate
    env=np.sin(np.linspace(0,np.pi,len(tt)))**2
    chord=[0,3,7] if bar%4==0 else [0,4,7]
    pad=sum(np.sin(2*np.pi*hz(root+i)*tt) for i in chord)/3
    add(pad*env,bar*beat*4,.08)
fade=np.minimum(1,np.arange(n)/(rate*.4))*np.minimum(1,np.arange(n-1,-1,-1)/(rate*1.5))
mix*=fade[:,None]
mix=np.tanh(mix*1.2)
mix*=.83/max(.01,float(np.max(np.abs(mix))))
with wave.open(str(WORK/"original-instrumental.wav"),"wb") as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(rate)
    wav.writeframes((mix*32767).astype("<i2").tobytes())

clips=[]
for i,seconds in enumerate(durations):
    output=WORK/("clip-%d.mp4"%i)
    frames=seconds*FPS
    vf=("zoompan=z='1+0.022*on/%d':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1080x1920:fps=30,"
        "fade=t=in:st=0:d=0.16,fade=t=out:st=%.2f:d=0.16,format=yuv420p")%(max(1,frames-1),seconds-.16)
    run(["ffmpeg","-hide_banner","-loglevel","error","-y","-loop","1","-framerate",FPS,"-i",WORK/("scene-%d.png"%i),
         "-vf",vf,"-frames:v",frames,"-an","-c:v","libx264","-preset","fast","-crf","19","-threads","2",output])
    clips.append(output)
concat=WORK/"clips.txt"
concat.write_text("".join("file '%s'\n"%p.resolve() for p in clips))
video=OUT/"ride-garage-launch-1080x1920.mp4"
run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","concat","-safe","0","-i",concat,
     "-i",WORK/"original-instrumental.wav","-map","0:v:0","-map","1:a:0","-c:v","copy",
     "-af","loudnorm=I=-16:TP=-1.5:LRA=11","-c:a","aac","-b:a","192k","-ar","48000","-t","25",
     "-movflags","+faststart",video])
run(["ffmpeg","-hide_banner","-loglevel","error","-y","-i",video,"-map","0:v:0","-c:v","copy","-an","-movflags","+faststart",OUT/"ride-garage-launch-no-music.mp4"])
probe=json.loads(subprocess.check_output(["ffprobe","-v","error","-show_format","-show_streams","-of","json",str(video)]))
vs=next(s for s in probe["streams"] if s["codec_type"]=="video")
au=next(s for s in probe["streams"] if s["codec_type"]=="audio")
assert (vs["width"],vs["height"],vs["codec_name"],vs["pix_fmt"])==(1080,1920,"h264","yuv420p")
assert vs["avg_frame_rate"]=="30/1"
assert au["codec_name"]=="aac"
assert 24.9<=float(probe["format"]["duration"])<=25.2
assert video.stat().st_size<95*1024*1024
run(["ffmpeg","-v","error","-i",video,"-f","null","-"])
(OUT/"validation.json").write_text(json.dumps(probe,indent=2))
caption="""Your bike. Your builds. Your riding life.

Meet Ride Garage: motorcycle photos and modifications, GPS ride recording, service records and fuel logs in one place.

Explore the public beta:
https://lagsautomotive.github.io/Ride-garage/

#RideGarage #MotorcycleLife #BikeBuild #MotoLife #MotorcycleCommunity
"""
(OUT/"caption.txt").write_text(caption)
(OUT/"README.txt").write_text("""Ride Garage launch pack
Main video: ride-garage-launch-1080x1920.mp4
25 seconds / 1080 x 1920 / 9:16 / H.264 / 30 fps / AAC stereo
Suitable for YouTube Shorts, Facebook Reels and Instagram Reels.
Original synthesized instrumental included; no spoken voiceover.
A silent version is included for adding a platform music track.
Covers: 9:16 and 4:5.
App screens are real browser captures using clearly labeled demo records.
Cinematic motorcycle hero artwork was generated for this promo.
No live rider records, cloud accounts or production app files were changed.
""")
print(json.dumps({"video":str(video),"bytes":video.stat().st_size,"seconds":probe["format"]["duration"],"video_codec":vs["codec_name"],"audio_codec":au["codec_name"],"validated":True}))
