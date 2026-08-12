# Delta Mobility

Mobility Intelligence Platform for taxi operators in Indonesia.

This prototype uses simulated mobility, demographic and taxi-demand data and an OpenStreetMap basemap. It is designed as a Vite + React application and is ready to deploy to GitHub + Vercel.

## Run locally

Requirements: Node.js 20.19+ (or Node 22.12+), consistent with current Vite requirements.

```bash
npm install
npm run dev
```

Open the local URL shown by Vite, normally `http://localhost:5173`.

## Production build

```bash
npm run build
npm run preview
```

## Deploy with Vercel

1. Push this repository to GitHub.
2. Import the repository into Vercel.
3. Vercel should detect Vite automatically.
4. Use the default build command `npm run build` and output directory `dist`.

## OpenStreetMap

The dashboard requests map tiles from `https://tile.openstreetmap.org`. Internet access is therefore required for the basemap. Keep the OpenStreetMap attribution shown in the app.

## Important

All mobility and demographic values are simulated. They do not represent individual-level mobility data or actual taxi demand.
