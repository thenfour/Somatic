// webpack build step to generate:
// - robots.txt
// - sitemap.xml

const { sources } = require('webpack');

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateRobotsTxt(seo) {
  const lines = [
    'User-agent: *',
    'Allow: /',
  ];

  const base = seo?.url;
  if (base) {
    lines.push('', `Sitemap: ${base}sitemap.xml`);
  }

  return `${lines.join('\n')}\n`;
}

function generateSitemapXml(seo) {
  const base = seo?.urlNoSlash;
  const routes = seo?.sitemap?.routes || ['/'];
  const changefreq = seo?.sitemap?.changefreq || 'weekly';
  const priority = seo?.sitemap?.priority || '1.0';

  const urls = routes
    .map((route) => {
      const normalizedRoute = route === '/' ? '/' : `/${String(route).replace(/^\/+/, '')}`;
      const loc = base ? `${base}${normalizedRoute}` : normalizedRoute;
      return [
        '  <url>',
        `    <loc>${xmlEscape(loc)}</loc>`,
        `    <changefreq>${xmlEscape(changefreq)}</changefreq>`,
        `    <priority>${xmlEscape(priority)}</priority>`,
        '  </url>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n');
}

class SeoAssetsWebpackPlugin {
  constructor(seo) {
    this.seo = seo;
  }

  apply(compiler) {
    const pluginName = 'SeoAssetsWebpackPlugin';
    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
      const stage = compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS;
      compilation.hooks.processAssets.tap(
        { name: pluginName, stage },
        () => {
          compilation.emitAsset('robots.txt', new sources.RawSource(generateRobotsTxt(this.seo)));
          compilation.emitAsset('sitemap.xml', new sources.RawSource(generateSitemapXml(this.seo)));
        }
      );
    });
  }
}

module.exports = {
  SeoAssetsWebpackPlugin,
};
