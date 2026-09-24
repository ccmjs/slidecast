/** English demo; component defaults remain German. */
import { demo as pdfDemo } from '../libs/pdf_viewer/resources/configs.mjs';

export const demo = {
  comments: true,
  autoplay: true,
  labels: {
    navigation: 'Slidecast navigation', previous: 'Previous', next: 'Next',
    step: 'Step', of: 'of', slide: 'Slide', audio: 'Slide audio',
    comments: 'Slide comments', commentsPlaceholder: 'Commenting will be added later.',
    missingLinkTarget: 'The linked PDF page is not part of this slidecast.',
    error: 'The slidecast could not be displayed: ', pdfNotOpened: 'The PDF was not opened.',
  },
  viewer: { labels: pdfDemo.labels },
  ignore: { slides: [
    { page: 1, audio: '././resources/welcome.mp3', description: '<h2>Welcome</h2><p>Each slide can include a description and an optional audio file.</p>' },
    { app: ['ccm.start', '././libs/hello/ccm.hello.mjs', { name: 'Slidecast' }] },
    { page: 2, description: '<p>After the embedded app, continue with the next PDF slide.</p>' },
    { page: 3 },
  ] },
};
