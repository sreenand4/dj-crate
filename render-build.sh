#!/bin/bash
set -e

# Install yt-dlp to local bin (writable)
mkdir -p $HOME/.local/bin
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o $HOME/.local/bin/yt-dlp
chmod a+rx $HOME/.local/bin/yt-dlp

# Add to PATH
export PATH="$HOME/.local/bin:$PATH"

# Install ffmpeg
apt-get install -y ffmpeg 2>/dev/null || echo "ffmpeg install skipped"

# Install node dependencies
npm install
npm run compile
