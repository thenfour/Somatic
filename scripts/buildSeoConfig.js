// gathers and processes SEO-related config from .env

function trimTrailingSlashes(url) {
  return url.replace(/\/+$/, '');
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function parseRoutes(raw) {
  const fallback = ['/'];
  if (!raw) return fallback;
  const routes = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((r) => (r.startsWith('/') ? r : `/${r}`));
  return routes.length ? routes : fallback;
}

function buildSeoConfig(env = process.env) {

  const siteUrlRaw = env.SITE_URL.trim();
  const siteUrl = ensureTrailingSlash(trimTrailingSlashes(siteUrlRaw));
  const siteUrlNoSlash = siteUrl ? trimTrailingSlashes(siteUrl) : '';

  const title = env.SEO_TITLE .trim();
  const siteName = env.SEO_SITE_NAME.trim();
  const description = env.SEO_DESCRIPTION .trim();
  const keywords = env.SEO_KEYWORDS .trim();
  const lang = env.SEO_LANG .trim();
  const robots = env.SEO_ROBOTS.trim();

  const ogType = env.SEO_OG_TYPE.trim();
  const ogImageUrl = env.SEO_OG_IMAGE.trim();

  const twitterCard = env.SEO_TWITTER_CARD .trim();

  const sitemapChangefreq = env.SEO_SITEMAP_CHANGEFREQ.trim();
  const sitemapPriority = env.SEO_SITEMAP_PRIORITY.trim();
  const routes = parseRoutes(env.SEO_ROUTES);

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: title,
    url: siteUrl,
    description,
    applicationCategory: env.SEO_APP_CATEGORY.trim(),
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: env.SEO_PRICE.trim(),
      priceCurrency: env.SEO_PRICE_CURRENCY.trim(),
    },
  };

  return {
    lang,
    title,
    siteName,
    description,
    keywords,
    robots,
    canonicalUrl: siteUrl,
    url: siteUrl,
    urlNoSlash: siteUrlNoSlash,
    og: {
      type: ogType,
      title,
      description,
      url: siteUrl,
      siteName,
      image: ogImageUrl,
    },
    twitter: {
      card: twitterCard,
      title,
      description,
      image: ogImageUrl,
    },
    sitemap: {
      routes,
      changefreq: sitemapChangefreq,
      priority: sitemapPriority,
    },
    structuredData,
  };
}

module.exports = {
  buildSeoConfig,
};
