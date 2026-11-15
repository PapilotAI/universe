// Static assets answer every existing path before this runs; anything else is the
// Universe 404 page. /universe without a slash goes to the gallery.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/universe') return Response.redirect(url.origin + '/universe/', 301);
    return env.ASSETS.fetch(request);
  },
};
