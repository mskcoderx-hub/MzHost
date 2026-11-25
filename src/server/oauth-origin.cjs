function callbackUrl(provider,secure) {
  const path='/api/'+provider+'-callback';
  const base=process.env.APP_ORIGIN?.trim() || (process.env.VERCEL_PROJECT_PRODUCTION_URL && 'https://'+process.env.VERCEL_PROJECT_PRODUCTION_URL);
  const explicit=process.env[provider.toUpperCase()+'_REDIRECT_URI']?.trim();
  const url=explicit ? new URL(explicit) : new URL(path,new URL(base).origin);
  if(url.username || url.password || url.search || url.hash || url.pathname!==path ||
    (url.protocol!=='https:' && (secure || url.protocol!=='http:' || !['localhost','127.0.0.1'].includes(url.hostname)))) throw Error('Invalid OAuth callback configuration.');
  return url;
}
module.exports={callbackUrl};
