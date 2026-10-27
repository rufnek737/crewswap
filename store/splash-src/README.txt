스플래시 원본 (2026-10-27)
- veo-dutyswap-20261027.mp4 : Veo 3.1 Lite 원본(글자 없음, 720x1280, 4초)
- overlay.py : 아이콘·「듀티스왑」·「DutySwap」·「Swap and Enjoy Life」 오버레이 PNG 생성
만들기:
  python3 overlay.py overlay.png ../../icon-512.png
  ffmpeg -i veo-dutyswap-20261027.mp4 -i overlay.png -filter_complex "[0:v]scale=1080:1920:flags=lanczos,delogo=x=845:y=1680:w=115:h=120[b];[b][1:v]overlay=0:0,format=yuv420p" -t 3 -c:v libx264 -profile:v main -preset slow -crf 22 -movflags +faststart -an ../../splash.mp4
  (delogo = Veo ✦ 표시 가림)
