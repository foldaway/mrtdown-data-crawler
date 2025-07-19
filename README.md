# mrtdown-data-crawler
Scripts to crawl for mrtdown-data

## Overview
This project contains Cloudflare Worker scripts designed to crawl various online sources for information related to MRT/LRT (Mass Rapid Transit/Light Rail Transit) train services, specifically focusing on Singapore. The collected data is then dispatched to a GitHub repository for further processing.

## Data Sources
The crawler currently gathers information from the following sources:

*   **Twitter (via Twitter API)**: Monitors official accounts like `SBSTransit_Ltd` and `SMRT_Singapore` for updates on train service disruptions or related news.
*   **Mastodon (via RSS)**: Collects alerts from the `ltatrainservicealerts` account on `mastodon.social`.
*   **Reddit (via RSS)**: Scans the `/r/singapore` subreddit for posts containing keywords like "mrt" or "train."
*   **News Websites (via RSS)**: Fetches news articles from prominent local news outlets such as `channelnewsasia.com` and `straitstimes.com`, filtering for rail-related content.

## Local Setup
To set up and run this project locally, follow these steps:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/foldaway/mrtdown-data-crawler.git
    cd mrtdown-data-crawler
    ```

2.  **Install dependencies:**
    This project uses Node.js and `npm`.
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    The project requires the following environment variables, typically set in a `.env` file for local development or as secrets in your Cloudflare Worker environment:

    *   `TWITTER_BEARER_TOKEN`: Your Bearer Token for accessing the Twitter API.
    *   `GITHUB_ACCESS_TOKEN`: A GitHub Fine-Grained Personal Access Token with Repository -> Contents (write) scope to dispatch events to the `foldaway/mrtdown-data` repository.

    Create a `.dev.vars` file in the root of the project:
    ```
    TWITTER_BEARER_TOKEN="YOUR_TWITTER_BEARER_TOKEN"
    GITHUB_ACCESS_TOKEN="YOUR_GITHUB_ACCESS_TOKEN"
    ```

4.  **Running Locally (Development):**
    You can test the Cloudflare Worker locally using `wrangler`:
    ```bash
    npm run dev
    ```
    This will start a local development server. You can then trigger the scheduled function manually or inspect logs.

5.  **Deployment:**
    For deployment to Cloudflare Workers, you would typically use `wrangler publish`. Ensure your `wrangler.toml` is configured correctly for your Cloudflare account.
