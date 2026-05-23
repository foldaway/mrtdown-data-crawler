import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  enrichNewsArticle,
  extractArticleContextFromHtml,
} from '../src/sources/articleEnrichment';

const fetchedAt = new Date('2026-05-22T04:00:00.000Z');

describe('article enrichment', () => {
  it('extracts article context from JSON-LD NewsArticle fields', () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "NewsArticle",
              "headline": "Train fault delays commuters on the East-West Line",
              "description": "Operator says additional travel time should be expected.",
              "articleBody": "Commuters travelling on the East-West Line were asked to add twenty minutes of travel time on Friday morning after a train fault near Jurong East. The operator said staff were deployed at affected stations and regular service resumed before the evening peak."
            }
          </script>
        </head>
      </html>
    `;

    assert.deepEqual(extractArticleContextFromHtml(html), {
      source: 'publisher',
      text: 'Train fault delays commuters on the East-West Line\n\nOperator says additional travel time should be expected.\n\nCommuters travelling on the East-West Line were asked to add twenty minutes of travel time on Friday morning after a train fault near Jurong East. The operator said staff were deployed at affected stations and regular service resumed before the evening peak.',
    });
  });

  it('falls back to OpenGraph and Twitter metadata when article body is unavailable', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="North-South Line services resume after signalling fault">
          <meta name="twitter:description" content="The disruption affected several stations during the morning commute.">
        </head>
      </html>
    `;

    assert.deepEqual(extractArticleContextFromHtml(html), {
      source: 'metadata',
      text: 'North-South Line services resume after signalling fault\n\nThe disruption affected several stations during the morning commute.',
    });
  });

  it('uses title and summary metadata when the publisher fetch fails', async () => {
    const fetcher = async () => {
      throw new Error('network unavailable');
    };

    const result = await enrichNewsArticle(
      {
        title: 'Circle Line delay clears',
        summary: 'Commuters were told to expect extra travel time.',
        url: 'https://www.example.com/news/circle-line-delay',
      },
      {
        fetcher,
        now: () => fetchedAt,
      },
    );

    assert.deepEqual(result, {
      articleText:
        'Circle Line delay clears\n\nCommuters were told to expect extra travel time.',
      articleTextSource: 'metadata',
      articleTextFetchedAt: '2026-05-22T04:00:00.000Z',
    });
  });

  it('extracts CNA-shaped article paragraphs without a source-specific adapter', () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="CNA title should not beat body paragraphs">
        </head>
        <body>
          <main>
            <article class="article">
              <h1>Train service resumes after track fault</h1>
              <div class="article-content">
                <p>SINGAPORE: Train service on the Downtown Line resumed after a track fault caused delays between several stations on Friday afternoon.</p>
                <p>The operator said free regular bus services were made available while engineers attended to the fault and station staff guided affected commuters.</p>
              </div>
            </article>
          </main>
        </body>
      </html>
    `;

    assert.deepEqual(extractArticleContextFromHtml(html), {
      source: 'publisher',
      text: 'SINGAPORE: Train service on the Downtown Line resumed after a track fault caused delays between several stations on Friday afternoon.\n\nThe operator said free regular bus services were made available while engineers attended to the fault and station staff guided affected commuters.',
    });
  });

  it('extracts Straits Times-shaped article paragraphs without a source-specific adapter', () => {
    const html = `
      <html>
        <body>
          <article>
            <section data-component="story-body">
              <p>Singapore - A signalling fault on the North East Line led to longer waits for commuters at several stations on Friday.</p>
              <p>SBS Transit said updates were posted on its social media channels and normal headways returned after checks were completed.</p>
            </section>
          </article>
        </body>
      </html>
    `;

    assert.deepEqual(extractArticleContextFromHtml(html), {
      source: 'publisher',
      text: 'Singapore - A signalling fault on the North East Line led to longer waits for commuters at several stations on Friday.\n\nSBS Transit said updates were posted on its social media channels and normal headways returned after checks were completed.',
    });
  });
});
