/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // Allow MAPBOX_PUBLIC_KEY as an alias for both client and server Mapbox vars
    NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.MAPBOX_PUBLIC_KEY || "",
    MAPBOX_TOKEN: process.env.MAPBOX_TOKEN || process.env.MAPBOX_PUBLIC_KEY || "",
  },
};

export default nextConfig;
