# Synthetic QuickTime audio fixtures

These files were generated locally with FFmpeg from a 64 × 48 test pattern and two sine waves. They contain no user media.

- `aac.mov`: 0.2 s H.264 video and stereo AAC, including normal AAC encoder priming.
- `pcm-sowt.mov`: 0.2 s H.264 video and stereo signed 16-bit little-endian PCM.
- `pcm-twos.mov`: 0.2 s H.264 video and stereo signed 16-bit big-endian PCM.
- `lpcm24.mov`: 0.2 s H.264 video and stereo 24-bit PCM at 96 kHz with QuickTime sound description version 2.
- `delayed-pcm.mov`: PCM audio starts 0.08 s after the video timeline origin.
- `no-audio.mov`: H.264 video with no audio track.
- `unsupported-apac-tag.mov`: a copy of `pcm-sowt.mov` with only its sample description codec tag changed to `apac`. This is an unsupported-codec metadata fixture, **not an actual APAC recording**.

The Node tests exercise the actual installed MOV parser and PCM decoder. AAC remux tests exercise the actual parser, packet copier, and MP4 writer; native AAC decoding must also be verified in a browser because Node does not supply that decoder.
