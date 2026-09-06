/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  reactStrictMode: true,
  // GitHub Pages sirve bajo subruta: https://<owner>.github.io/kubernetes-goty/
  ...(isProd
    ? {
        output: 'export',
        basePath: '/kubernetes-goty',
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
