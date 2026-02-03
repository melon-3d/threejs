# Customer Readme — Launch & Deploy

## Launch (development)

1. Copy `example.env` to `.env` and set the variables as needed (see [Configuration](#configuration)).
2. Install dependencies:

    ```bash
    npm install
    ```

3. Start the dev server:

    ```bash
    npm run dev
    ```

4. Open the URL shown in the terminal (e.g. `http://localhost:5173`).

## Deploy (production)

1. Copy `example.env` to `.env` and set the variables for your environment.
2. Build the app:

    ```bash
    npm run build
    ```

3. Deploy the contents of the `dist/` folder to your static hosting or web server (e.g. nginx, Apache, or a CDN). Point the document root to `dist/` and ensure `index.html` is served for client-side routing.

## Configuration

Configure the app via a `.env` file (use `example.env` as a template).

| Variable                     | Description                                                                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VITE_DICTIONARY_URL**      | Full URL of the dictionary/API service (e.g. `http://api.example.com/dictionary`). See [Dictionary API](#dictionary-api) below. **Optional:** leave empty to use the bundled `public/defects.json` on first load. |
| **VITE_ENVIRONMENT_MAP_URL** | Optional. URL of an EXR environment map for 3D lighting/reflections (e.g. `/venice_sunset_sky.exr`). If unset, built-in fallback lighting is used.                                                                |

## Dictionary API

The **dictionary API** is the backend service that supplies the **list of defects** used in the app. When `VITE_DICTIONARY_URL` is set, the app calls it to fetch this list; the entries are then shown in a **dropdown** so the user can select a defect type when working with the 3D model.

**Behaviour:**

- **On first launch**, if the browser has no cached dictionary: when `VITE_DICTIONARY_URL` is set, the app requests the dictionary from that URL and stores the result in **localStorage**. When `VITE_DICTIONARY_URL` is empty, the app loads the bundled `public/defects.json` and stores it in **localStorage**. The dropdown is populated from this cached data.
- **There is no automatic sync.** If the dictionary on the server is updated, the app will not refresh it by itself. Users must manually trigger a reload: open **Settings** and use **"Reload Dictionary"**. If the URL is set, the app fetches the latest list from the API and updates the cache; if the URL is not set, a toast message indicates that the bundled data from the repository is used.
- When the URL is set, it must point to a live endpoint that returns the defect list in the format the app expects; CORS must be enabled on that endpoint if it is on a different origin (see next section).

## CORS for the dictionary URL

If `VITE_DICTIONARY_URL` points to a different origin than the app (e.g. the app is on `https://app.example.com` and the API on `https://api.example.com`), the **server that serves the dictionary API** must send CORS headers. Otherwise the browser will block requests.

Configure that server to:

1. **Respond to `OPTIONS` (preflight) requests** to the dictionary URL with status `204` and these headers:
    - `Access-Control-Allow-Origin: *` (or your app origin)
    - `Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE, PATCH`
    - `Access-Control-Allow-Headers: DNT, User-Agent, X-Requested-With, If-Modified-Since, Cache-Control, Content-Type, Range, Authorization`
    - `Access-Control-Max-Age: 1728000`

2. **Add the same CORS headers to normal responses** (GET, POST, etc.) for the dictionary endpoint:
    - `Access-Control-Allow-Origin: *` (or your app origin)
    - `Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE, PATCH`
    - `Access-Control-Allow-Headers: DNT, User-Agent, X-Requested-With, If-Modified-Since, Cache-Control, Content-Type, Range, Authorization`

How to do this depends on your stack (e.g. nginx `add_header`, Apache `Header set`, or your backend framework's CORS settings).

## Environment map (EXR)

The EXR file for `VITE_ENVIRONMENT_MAP_URL` is **not included** in the repository. After deployment you can add your own file (e.g. place it in `public/` before build, or under the same origin and set `VITE_ENVIRONMENT_MAP_URL` to its path).

A common free example is **Venice Sunset** from [Poly Haven](https://polyhaven.com/a/venice_sunset): CC0 (public domain), by Greg Zaal, widely used as a sample environment map. You can download the EXR there and use it if desired.

EXR files are often large. They compress very well with gzip. It is recommended to **serve the EXR pre-compressed as `.exr.gz`** (and set `VITE_ENVIRONMENT_MAP_URL` to that URL if your stack serves gzip correctly), or ensure your server uses gzip compression for `.exr` so transfer size stays low.
