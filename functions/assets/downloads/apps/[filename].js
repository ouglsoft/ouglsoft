// Keep the public download URLs stable, whether APKs live in Pages or R2.
const FILENAMES = new Set([
  'zad-al-muslim.apk',
  'nouakchott-cadastre.apk',
  'almoathen-shinqiti.apk',
  'my-agenda.apk',
  'safe-to-spend.apk',
]);

export async function onRequest(context) {
  const { request, params, env } = context;
  const filename = params.filename;
  if (!FILENAMES.has(filename)) return context.next();
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const bucket = env.OUGLSOFT_APK_DOWNLOADS;
  if (!bucket) return context.next();
  const key = 'assets/downloads/apps/' + filename;
  const object = request.method === 'HEAD' ? await bucket.head(key) : await bucket.get(key);
  if (!object) return context.next();
  const headers = new Headers({
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'Cache-Control': 'no-cache, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Length': String(object.size),
  });
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}
