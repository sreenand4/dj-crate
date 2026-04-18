import Anthropic from '@anthropic-ai/sdk';
import { searchYouTube } from './searchYouTube';
import { searchSoundCloud } from './searchSoundCloud';
import { downloadTrack } from './downloadTrack';
import { stageFile } from './stageFile';
import { getFolders } from './getFolders';
import { createFolder } from './createFolder';
import { dumpLibrary } from './dumpLibrary';

export const tools: Anthropic.Messages.Tool[] = [
  {
    name: 'searchYouTube',
    description:
      'Search YouTube for a song. Returns up to 3 ranked candidates with title, channel, URL, and score. Use excludeVariants=true to filter out slowed/reverb/nightcore/cover versions.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query, e.g. "Lil Tjay Calling My Phone" or "Drake God\'s Plan official audio"',
        },
        excludeVariants: {
          type: 'boolean',
          description: 'If true, filter out slowed, reverb, sped up, nightcore, cover, reaction, extended mix, tutorial, and hour-long versions',
        },
      },
      required: ['query', 'excludeVariants'],
    },
  },
  {
    name: 'searchSoundCloud',
    description:
      'Search SoundCloud for a track using yt-dlp. Best for DJ edits, bootlegs, remixes, flips, and unreleased tracks. Returns up to 3 results with real SoundCloud URLs — pass the best URL to downloadTrack with source "soundcloud".',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query, e.g. "Chris Brown No Guidance Brizzy Edit" or "Drake God\'s Plan bootleg"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'downloadTrack',
    description:
      'Download a track from a given URL as an MP3 to a local temp path. Returns the local file path on success. Must be called before stageFile.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full URL of the track to download (YouTube or SoundCloud)',
        },
        source: {
          type: 'string',
          enum: ['youtube', 'soundcloud'],
          description: 'Where the URL is from',
        },
        songName: {
          type: 'string',
          description: 'Clean song name for the output filename, e.g. "Calling My Phone"',
        },
        artist: {
          type: 'string',
          description: 'Artist name for the output filename, e.g. "Lil Tjay"',
        },
      },
      required: ['url', 'source', 'songName', 'artist'],
    },
  },
  {
    name: 'stageFile',
    description:
      'Upload a downloaded MP3 to the cloud library and record it in the staging manifest. Always call getFolders first to pick the right folder.',
    input_schema: {
      type: 'object',
      properties: {
        localPath: {
          type: 'string',
          description: 'Absolute local path to the MP3 file (returned by downloadTrack)',
        },
        folder: {
          type: 'string',
          description: 'Destination folder name from the known folders list, e.g. "Club_Classics"',
        },
        songName: {
          type: 'string',
          description: 'Human-readable song name for the manifest',
        },
        artist: {
          type: 'string',
          description: 'Artist name for the manifest',
        },
        source: {
          type: 'string',
          enum: ['youtube', 'soundcloud'],
          description: 'Download source',
        },
        sourceUrl: {
          type: 'string',
          description: 'Original URL the track was downloaded from',
        },
      },
      required: ['localPath', 'folder', 'songName', 'artist', 'source', 'sourceUrl'],
    },
  },
  {
    name: 'getFolders',
    description:
      'Get the current list of known folders in the library. Always call this before stageFile to pick the right destination.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'createFolder',
    description:
      'Create a new folder in the library. Only do this when you are confident the folder is genuinely useful and reusable — not a one-off. Tell the user you created it in your final response.',
    input_schema: {
      type: 'object',
      properties: {
        folderName: {
          type: 'string',
          description: 'Name of the new folder, e.g. "Afrobeats" or "R&B_Slow"',
        },
      },
      required: ['folderName'],
    },
  },
  {
    name: 'dumpLibrary',
    description:
      'Package all staged songs into a zip file and return a download URL. Wipes the staging area clean afterwards. Call this when the user says "dump" or any variation.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

export const toolHandlers: Record<string, (input: any) => Promise<any>> = {
  searchYouTube:    (input) => searchYouTube(input),
  searchSoundCloud: (input) => searchSoundCloud(input),
  downloadTrack:    (input) => downloadTrack(input),
  stageFile:        (input) => stageFile(input),
  getFolders:       ()      => getFolders(),
  createFolder:     (input) => createFolder(input),
  dumpLibrary:      ()      => dumpLibrary(),
};
