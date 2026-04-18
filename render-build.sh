#!/bin/bash
set -e

# Install yt-dlp directly into project directory
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ./yt-dlp
chmod a+rx ./yt-dlp

echo "yt-dlp installed at: $(pwd)/yt-dlp"
ls -la ./yt-dlp

# Install ffmpeg
apt-get install -y ffmpeg 2>/dev/null || echo "ffmpeg install skipped"

# Install node dependencies
npm install
npm run compile
