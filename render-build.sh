#!/bin/bash
set -e

# Install yt-dlp
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp

# Install ffmpeg (required for audio conversion)
apt-get install -y ffmpeg

# Install node dependencies and build
npm install
npm run compile
