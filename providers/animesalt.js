// AnimeSalt Provider for Nuvio (Self-Contained Build)
// NO local require dependencies! Only ES5-safe .then() chains!

var TMDB_KEY = 'd80ba92bc7cefe3359668d30d06f3305';
var TVDB_API_KEY = '248a0899-bd5b-4f58-a4db-9900c4ef0dae';
var BASE = 'https://animesalt.link';
var CDN = 'https://as-cdn21.top';
var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

var tvdbTokenCache = null;
var tvdbTokenExpiry = 0;

function getTvdbToken() {
  var now = Date.now();
  if (tvdbTokenCache && now < tvdbTokenExpiry) {
    return Promise.resolve(tvdbTokenCache);
  }

  return fetch('https://api4.thetvdb.com/v4/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ apikey: TVDB_API_KEY }),
  })
    .then(function (res) {
      if (!res.ok) throw new Error('TVDB token failed: ' + res.status);
      return res.json();
    })
    .then(function (data) {
      if (!data || !data.data || !data.data.token) {
        throw new Error('Invalid TVDB token');
      }
      tvdbTokenCache = data.data.token;
      tvdbTokenExpiry = now + 24 * 60 * 60 * 1000;
      return tvdbTokenCache;
    });
}

function getTvdbEpisodeMapping(tmdbId, season, episode) {
  var extUrl =
    'https://api.themoviedb.org/3/tv/' +
    tmdbId +
    '/external_ids?api_key=' +
    TMDB_KEY;
  var epUrl =
    'https://api.themoviedb.org/3/tv/' +
    tmdbId +
    '/season/' +
    season +
    '/episode/' +
    episode +
    '?api_key=' +
    TMDB_KEY;

  return Promise.all([
    fetch(extUrl).then(function (r) {
      return r.json();
    }),
    fetch(epUrl).then(function (r) {
      return r.json();
    }),
  ])
    .then(function (results) {
      var extData = results[0];
      var epData = results[1];

      var tvdbId = extData ? extData.tvdb_id : null;
      var airDate = epData ? epData.air_date : null;
      var epName = epData ? epData.name : null;

      if (!tvdbId || (!airDate && !epName)) return null;

      return getTvdbToken().then(function (token) {
        return fetch(
          'https://api4.thetvdb.com/v4/series/' + tvdbId + '/episodes/default',
          {
            headers: {
              Authorization: 'Bearer ' + token,
              Accept: 'application/json',
            },
          },
        )
          .then(function (res) {
            if (!res.ok) throw new Error('TVDB fetch episodes failed');
            return res.json();
          })
          .then(function (tvdbRes) {
            if (!tvdbRes || !tvdbRes.data || !tvdbRes.data.episodes)
              return null;

            var episodes = tvdbRes.data.episodes;
            for (var i = 0; i < episodes.length; i++) {
              var ep = episodes[i];
              if (
                (airDate && ep.aired === airDate) ||
                (epName &&
                  ep.name &&
                  ep.name.toLowerCase() === epName.toLowerCase())
              ) {
                return {
                  season: ep.seasonNumber,
                  episode: ep.number,
                  absoluteEpisode: ep.absoluteNumber || null,
                };
              }
            }
            return null;
          });
      });
    })
    .catch(function () {
      return null;
    });
}

function httpGet(url, headers) {
  return fetch(url, {
    headers: Object.assign({ 'User-Agent': UA }, headers || {}),
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  });
}

function httpPost(url, body, headers) {
  return fetch(url, {
    method: 'POST',
    headers: Object.assign(
      {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      headers || {},
    ),
    body: body,
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

function cleanTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchSite(title, mediaType, year) {
  var url = BASE + '/?s=' + encodeURIComponent(title);
  return httpGet(url, { Referer: BASE + '/' }).then(function (html) {
    var results = [];
    var containerMatch = html.match(
      /id="movies-a"([\s\S]*?)(?=<footer|id="footer|class="footer)/m,
    );
    var searchHtml = containerMatch ? containerMatch[1] : html;

    var articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/g;
    var articleMatch;
    while ((articleMatch = articleRegex.exec(searchHtml)) !== null) {
      var articleHtml = articleMatch[1];
      var linkMatch = articleHtml.match(
        /href="(https:\/\/animesalt\.link\/(series|movies)\/([^\/\"]+)\/?)\"/,
      );
      var titleMatch = articleHtml.match(/class="entry-title"[^>]*>([^<]+)</);
      var yearMatch = articleHtml.match(/class="year"[^>]*>(\d{4})</);

      if (linkMatch && titleMatch) {
        var slug = linkMatch[3];
        var type = linkMatch[2];
        var itemTitle = titleMatch[1].trim();
        var itemYear = yearMatch ? parseInt(yearMatch[1]) : null;
        var exists = false;
        for (var i = 0; i < results.length; i++) {
          if (results[i].slug === slug) {
            exists = true;
            break;
          }
        }
        if (!exists && slug && slug !== 'page') {
          results.push({
            url: linkMatch[1],
            type: type,
            slug: slug,
            title: itemTitle,
            year: itemYear,
          });
        }
      }
    }

    var filtered = results;
    if (mediaType === 'movie') {
      var movies = results.filter(function (r) {
        return r.type === 'movies';
      });
      if (movies.length > 0) filtered = movies;
    } else {
      var series = results.filter(function (r) {
        return r.type === 'series';
      });
      if (series.length > 0) filtered = series;
    }

    var withYear = [];
    var withoutYear = [];
    if (year) {
      withYear = filtered.filter(function (r) {
        return r.year && Math.abs(r.year - year) <= 1;
      });
      withoutYear = filtered.filter(function (r) {
        return !r.year;
      });
    }

    var candidates =
      withYear.length > 0 ? withYear : year ? withoutYear : filtered;
    if (candidates.length === 0) candidates = filtered;

    var cleanSearch = cleanTitle(title);
    candidates.sort(function (a, b) {
      var cleanA = cleanTitle(a.title);
      var cleanB = cleanTitle(b.title);
      var exactA = cleanA === cleanSearch ? 0 : 1;
      var exactB = cleanB === cleanSearch ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;
      var startsA = cleanA.indexOf(cleanSearch) === 0 ? 0 : 1;
      var startsB = cleanB.indexOf(cleanSearch) === 0 ? 0 : 1;
      if (startsA !== startsB) return startsA - startsB;
      return cleanA.length - cleanB.length;
    });

    return candidates;
  });
}

function getEpisodeUrlFromHtml(html, season, episode) {
  var epRegex = new RegExp(
    'href="(https://animesalt\\.link/episode/[^"]*' +
      season +
      'x' +
      episode +
      '[^"]*)"',
  );
  var epMatch = html.match(epRegex);
  if (epMatch) return epMatch[1];
  return null;
}

function getEpisodeUrl(seriesUrl, season, episode) {
  return httpGet(seriesUrl, { Referer: BASE + '/' }).then(function (html) {
    var seasons = [];
    var seasonRegex = /data-post="(\d+)"\s+data-season="(\d+)"/g;
    var m;
    while ((m = seasonRegex.exec(html)) !== null) {
      seasons.push({ post: m[1], season: parseInt(m[2]) });
    }
    if (seasons.length === 0) {
      return getEpisodeUrlFromHtml(html, season, episode);
    }
    var target = null;
    for (var i = 0; i < seasons.length; i++) {
      if (seasons[i].season === parseInt(season)) {
        target = seasons[i];
        break;
      }
    }
    if (!target) return null;
    var ajaxUrl =
      BASE +
      '/wp-admin/admin-ajax.php?action=action_select_season&season=' +
      season +
      '&post=' +
      target.post;
    return httpGet(ajaxUrl, { Referer: seriesUrl }).then(function (epHtml) {
      return getEpisodeUrlFromHtml(epHtml, season, episode);
    });
  });
}

function getEpisodeUrlWithCandidates(seriesUrl, candidatePairs) {
  if (!candidatePairs || candidatePairs.length === 0) {
    return Promise.resolve(null);
  }

  var pair = candidatePairs[0];
  var remaining = candidatePairs.slice(1);

  return getEpisodeUrl(seriesUrl, pair.season, pair.episode).then(
    function (url) {
      if (url) return url;
      if (pair.absoluteEpisode) {
        return getEpisodeUrl(seriesUrl, 1, pair.absoluteEpisode).then(
          function (absUrl) {
            if (absUrl) return absUrl;
            return getEpisodeUrlWithCandidates(seriesUrl, remaining);
          },
        );
      }
      return getEpisodeUrlWithCandidates(seriesUrl, remaining);
    },
  );
}

function getStreamFromPage(pageUrl) {
  return httpGet(pageUrl, { Referer: BASE + '/' }).then(function (html) {
    var iframeMatch = html.match(
      /src="(https:\/\/as-cdn\d+\.top\/video\/([a-f0-9]+))"/,
    );
    if (!iframeMatch) return null;
    var playerUrl = iframeMatch[1];
    var hash = iframeMatch[2];
    var playerCdn = playerUrl.split('/video/')[0];
    return httpPost(
      playerCdn + '/player/index.php?data=' + hash + '&do=getVideo',
      'hash=' + hash + '&r=' + encodeURIComponent(BASE + '/'),
      {
        Referer: BASE + '/',
        Origin: playerCdn,
        'X-Requested-With': 'XMLHttpRequest',
      },
    ).then(function (data) {
      var m3u8 = data.videoSource || data.securedLink;
      if (!m3u8) return null;
      var contentHashMatch = m3u8.match(/\/hls\/([a-f0-9]+)\//);
      var contentHash = contentHashMatch ? contentHashMatch[1] : hash;
      var cdnBase = m3u8.split('/cdn/hls/')[0];
      var subtitle =
        cdnBase + '/cdn/down/' + contentHash + '/Subtitle/subtitle_eng.srt';
      return { url: m3u8, subtitle: subtitle, cdnBase: cdnBase };
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  return new Promise(function (resolve) {
    var tmdbUrl =
      mediaType === 'movie'
        ? 'https://api.themoviedb.org/3/movie/' +
          tmdbId +
          '?api_key=' +
          TMDB_KEY
        : 'https://api.themoviedb.org/3/tv/' + tmdbId + '?api_key=' + TMDB_KEY;

    var seriesTitle = '';
    var seriesYear = null;

    fetch(tmdbUrl)
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        seriesTitle = data.title || data.name;
        if (!seriesTitle) throw new Error('No title');
        var releaseDate = data.release_date || data.first_air_date || '';
        seriesYear = releaseDate ? parseInt(releaseDate.split('-')[0]) : null;
        return searchSite(seriesTitle, mediaType, seriesYear);
      })
      .then(function (results) {
        if (!results || results.length === 0) {
          resolve([]);
          return null;
        }

        var result = results[0];
        if (mediaType === 'movie') {
          return getStreamFromPage(result.url);
        }

        var s = parseInt(season) || 1;
        var e = parseInt(episode) || 1;
        var candidates = [{ season: s, episode: e }];

        // Add heuristic multi-cour/season fallbacks (Kaiju No. 8)
        if (s === 1 && e > 12) {
          candidates.push({ season: 2, episode: e - 12 });
        } else if (s === 2 && e === 1) {
          candidates.push({ season: 1, episode: 13 });
        }

        return getTvdbEpisodeMapping(tmdbId, s, e)
          .then(function (tvdbMapping) {
            if (tvdbMapping) {
              var isDuplicate = false;
              for (var i = 0; i < candidates.length; i++) {
                if (
                  candidates[i].season === tvdbMapping.season &&
                  candidates[i].episode === tvdbMapping.episode
                ) {
                  isDuplicate = true;
                  break;
                }
              }
              if (!isDuplicate) {
                candidates.push(tvdbMapping);
              }
            }
            return getEpisodeUrlWithCandidates(result.url, candidates);
          })
          .then(function (epUrl) {
            if (!epUrl) return null;
            return getStreamFromPage(epUrl);
          });
      })
      .then(function (streamData) {
        if (!streamData) {
          resolve([]);
          return;
        }
        var cdnDomain = streamData.cdnBase || CDN;
        resolve([
          {
            name: '🧂 AnimeSalt',
            title: 'AnimeSalt • Multi-Audio',
            url: streamData.url,
            quality: 'Auto',
            headers: {
              Referer: cdnDomain + '/',
              Origin: cdnDomain,
              'User-Agent': UA,
            },
            subtitles: streamData.subtitle
              ? [{ url: streamData.subtitle, lang: 'en', name: 'English' }]
              : [],
          },
        ]);
      })
      .catch(function () {
        resolve([]);
      });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else if (typeof global !== 'undefined') {
  global.getStreams = getStreams;
}
