export const demo = {
  comments: true,
  autoplay: true,
  ignore: { slides: [
    { page: 1, audio: '././resources/welcome.mp3', description: '<h2>Welcome</h2><p>Each slide can include a description and an optional audio file.</p>' },
    { app: ['ccm.start', 'https://cdn.jsdelivr.net/gh/ccmjs/hello@v1.0.3/ccm.hello-1.0.3.min.mjs', { name: 'Slidecast' }] },
    { page: 2, description: '<p>After the embedded app, continue with the next PDF slide.</p>' },
    { page: 3 },
  ] },
};
