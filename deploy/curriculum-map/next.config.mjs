/** Only the public map and its two API routes are included in this deployment. */
const config = {
  poweredByHeader: false,
  compress: true,
  outputFileTracingIncludes: {
    '/api/curriculum-map/*': ['./public/**/*.json'],
  },
  async redirects() {
    return [{ source: '/curriculum-map', destination: '/', permanent: false }]
  },
}

export default config
