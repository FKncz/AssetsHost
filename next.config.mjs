/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['*.replit.dev', '*.pike.replit.dev'],
  // binary files must stream through byte exact => gzip would corrupt Content-Length/ETag.
  compress: false,
};

export default nextConfig;
