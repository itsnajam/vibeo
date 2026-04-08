# Vibeio Web

Vibeio is now organized as a browser-first product in the workspace root, with the previous Expo/mobile implementation archived in [mobile-legacy](E:\Vibe Share\mobile-legacy).

## Structure

- [mobile-legacy](E:\Vibe Share\mobile-legacy): the archived Expo app
- Root app: the new dedicated web app

## Web product direction

- The host creates a room and gets a clean room URL like `/room/ABC123`
- Guests open that URL, sign in or sign up, and land straight into the room
- Playback uses embedded YouTube plus Supabase-backed room state and Realtime subscriptions

## Local setup

1. Install dependencies with `npm install`
2. Start the web app with `npm run dev`
3. Open the local URL in your browser

## Supabase

The browser app still depends on the same Supabase schema and Realtime setup. The migration from the legacy app has been copied into [supabase](E:\Vibe Share\supabase) for the web project to use as its source of truth.

## Design direction

The current web app uses a funky but pleasing visual style:

- warm citrus orange
- mint teal
- candy pink accents
- creamy backgrounds
- bold rounded cards
- a custom matching Vibeio logo
