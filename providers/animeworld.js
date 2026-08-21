// ================================================================
// AnimeWorld India — Android TV / Nuvio Compatible (Self-Contained)
// NO local require dependencies!
// ================================================================

var TMDB_KEY = 'd80ba92bc7cefe3359668d30d06f3305';
var TVDB_API_KEY = '248a0899-bd5b-4f58-a4db-9900c4ef0dae';
var BASE = 'https://watchanimeworld.top';
var PLAYER = 'https://play.zephyrix.top';
var UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    if (!r.ok) throw new Error('HTTP ' + r.status + ' on ' + url);
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
    if (!r.ok) throw new Error('HTTP ' + r.status + ' on ' + url);
    return r.json();
  });
}

function searchSite(title, mediaType) {
  var url = BASE + '/?s=' + encodeURIComponent(title);
  return httpGet(url, { Referer: BASE + '/' }).then(function (html) {
    var results = [];
    var re =
      /href=["'](?:https?:\/\/watchanimeworld\.top)?\/(series|movies)\/([^\/\?"']+)\/?["']/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var type = m[1],
        slug = m[2];
      if (slug && slug !== 'page') {
        results.push({
          url: BASE + '/' + type + '/' + slug + '/',
          type: type,
          slug: slug,
        });
      }
    }
    return results.filter(function (r) {
      return mediaType === 'movie' ? r.type === 'movies' : r.type === 'series';
    });
  });
}

function getEpisodeUrl(seriesObj, season, episode) {
  var seriesUrl = seriesObj.url;
  var seriesSlug = seriesObj.slug;

  return httpGet(seriesUrl, { Referer: BASE + '/' }).then(function (html) {
    var s = parseInt(season);
    var e = parseInt(episode);
    var padE = e < 10 ? '0' + e : '' + e;

    var targets = [
      s + 'x' + e,
      s + 'x' + padE,
      seriesSlug + '-' + s + 'x' + e,
      seriesSlug + '-' + s + 'x' + padE,
      seriesSlug + '-season-' + s + '-episode-' + e,
    ];

    for (var i = 0; i < targets.length; i++) {
      var pattern = new RegExp(
        'href=["\'](?:https?:\\/\\/watchanimeworld\\.top)?\\/episode\\/([^"\'\\?]*' +
          targets[i] +
          '[^"\'\\?]*)[\\"\']',
        'i',
      );
      var match = html.match(pattern);
      if (match) {
        return BASE + '/episode/' + match[1].replace(/^\/+|\/+$/g, '') + '/';
      }
    }

    var pidM =
      html.match(/postid-(\d+)/) || html.match(/data-post=["'](\d+)["']/);
    if (!pidM) {
      return BASE + '/episode/' + seriesSlug + '-' + s + 'x' + e + '/';
    }

    var ajaxUrl =
      BASE +
      '/wp-admin/admin-ajax.php?action=action_select_season&season=' +
      s +
      '&post=' +
      pidM[1];

    return httpGet(ajaxUrl, { Referer: seriesUrl })
      .then(function (epHtml) {
        for (var j = 0; j < targets.length; j++) {
          var re = new RegExp(
            'href=["\'](?:https?:\\/\\/watchanimeworld\\.top)?\\/episode\\/([^"\'\\?]*' +
              targets[j] +
              '[^"\'\\?]*)[\\"\']',
            'i',
          );
          var m = epHtml.match(re);
          if (m) {
            return BASE + '/episode/' + m[1].replace(/^\/+|\/+$/g, '') + '/';
          }
        }
        return BASE + '/episode/' + seriesSlug + '-' + s + 'x' + e + '/';
      })
      .catch(function () {
        return BASE + '/episode/' + seriesSlug + '-' + s + 'x' + e + '/';
      });
  });
}

function extractStreamFromHash(videoHash) {
  var videoPageUrl = PLAYER + '/video/' + videoHash;

  return httpPost(
    PLAYER + '/player/index.php?data=' + videoHash + '&do=getVideo',
    'hash=' +
      encodeURIComponent(videoHash) +
      '&r=' +
      encodeURIComponent(BASE + '/'),
    {
      Referer: videoPageUrl,
      Origin: PLAYER,
      'X-Requested-With': 'XMLHttpRequest',
    },
  ).then(function (data) {
    var m3u8 = data.videoSource || data.securedLink || data.file || data.url;
    if (!m3u8) return null;

    var contentHashM = m3u8.match(/\/cdn\/hls\/([a-zA-Z0-9_-]+)\//);
    var contentHash = contentHashM ? contentHashM[1] : videoHash;
    var subtitleUrl =
      PLAYER + '/cdn/down/' + contentHash + '/Subtitle/subtitle_eng.srt';

    return { url: m3u8, subtitle: subtitleUrl };
  });
}

function getStreamFromPage(pageUrl) {
  return httpGet(pageUrl, { Referer: BASE + '/' })
    .then(function (html) {
      var iframeM =
        html.match(
          /(?:src|data-src)=["'](?:https?:)?\/\/play\.zephyrix\.top\/video\/([a-zA-Z0-9_-]+)["']/,
        ) ||
        html.match(/play\.zephyrix\.top\/video\/([a-zA-Z0-9_-]+)/) ||
        html.match(/play\.zephyrix\.top\/embed\/([a-zA-Z0-9_-]+)/);

      if (iframeM) {
        return extractStreamFromHash(iframeM[1]);
      }

      var optM = html.match(
        /class=["']dooplay_player_option[^"']*["'][^>]*data-post=["'](\d+)["'][^>]*data-nume=["'](\d+|opt\w+)["'][^>]*data-type=["'](\w+)["']/,
      );
      if (optM) {
        var ajaxPlayerUrl =
          BASE +
          '/wp-admin/admin-ajax.php?action=doo_player_ajax&post=' +
          optM[1] +
          '&nume=' +
          optM[2] +
          '&type=' +
          optM[3];

        return httpGet(ajaxPlayerUrl, { Referer: pageUrl }).then(
          function (pHtml) {
            var pIframe =
              pHtml.match(/play\.zephyrix\.top\/video\/([a-zA-Z0-9_-]+)/) ||
              pHtml.match(/play\.zephyrix\.top\/embed\/([a-zA-Z0-9_-]+)/);
            if (pIframe) {
              return extractStreamFromHash(pIframe[1]);
            }
            return null;
          },
        );
      }

      return null;
    })
    .catch(function () {
      return null;
    });
}

function resolveEpisodeStreamWithCandidates(seriesList, candidatePairs) {
  if (!seriesList || seriesList.length === 0) return Promise.resolve(null);
  if (!candidatePairs || candidatePairs.length === 0)
    return Promise.resolve(null);

  var seriesObj = seriesList[0];
  var remainingSeries = seriesList.slice(1);

  function tryPairs(pairs) {
    if (!pairs || pairs.length === 0) return Promise.resolve(null);
    var pair = pairs[0];
    var remainingPairs = pairs.slice(1);

    return getEpisodeUrl(seriesObj, pair.season, pair.episode)
      .then(function (epUrl) {
        return epUrl ? getStreamFromPage(epUrl) : null;
      })
      .then(function (streamData) {
        if (streamData && streamData.url) return streamData;

        if (pair.absoluteEpisode) {
          return getEpisodeUrl(seriesObj, 1, pair.absoluteEpisode)
            .then(function (absUrl) {
              return absUrl ? getStreamFromPage(absUrl) : null;
            })
            .then(function (absStream) {
              if (absStream && absStream.url) return absStream;
              return tryPairs(remainingPairs);
            });
        }
        return tryPairs(remainingPairs);
      });
  }

  return tryPairs(candidatePairs).then(function (foundStream) {
    if (foundStream && foundStream.url) return foundStream;
    return resolveEpisodeStreamWithCandidates(remainingSeries, candidatePairs);
  });
}

function buildEpisodeCandidates(season, episode, tvdbMapping) {
  var s = parseInt(season) || 1;
  var e = parseInt(episode) || 1;
  var candidates = [{ season: s, episode: e }];

  if (s === 1 && e > 12) {
    candidates.push({ season: 2, episode: e - 12 });
  } else if (s === 2 && e === 1) {
    candidates.push({ season: 1, episode: 13 });
  }

  if (tvdbMapping) {
    var isDup = false;
    for (var i = 0; i < candidates.length; i++) {
      if (
        candidates[i].season === tvdbMapping.season &&
        candidates[i].episode === tvdbMapping.episode
      ) {
        isDup = true;
        break;
      }
    }
    if (!isDup) {
      candidates.push(tvdbMapping);
    }
  }

  return candidates;
}

function getStreams(tmdbId, mediaType, season, episode) {
  return new Promise(function (resolve) {
    var tmdbUrl =
      'https://api.themoviedb.org/3/' +
      (mediaType === 'movie' ? 'movie' : 'tv') +
      '/' +
      tmdbId +
      '?api_key=' +
      TMDB_KEY;

    fetch(tmdbUrl)
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var title = data.title || data.name;
        if (!title) throw new Error('No title found from TMDB');
        return searchSite(title, mediaType);
      })
      .then(function (results) {
        if (!results || results.length === 0) {
          resolve([]);
          return null;
        }

        if (mediaType === 'movie') {
          return getStreamFromPage(results[0].url);
        }

        var parsedSeason = parseInt(season) || 1;
        var parsedEpisode = parseInt(episode) || 1;

        return getTvdbEpisodeMapping(tmdbId, parsedSeason, parsedEpisode).then(
          function (tvdbMapping) {
            var candidates = buildEpisodeCandidates(
              parsedSeason,
              parsedEpisode,
              tvdbMapping,
            );
            return resolveEpisodeStreamWithCandidates(results, candidates);
          },
        );
      })
      .then(function (streamData) {
        if (!streamData || !streamData.url) {
          resolve([]);
          return;
        }

        resolve([
          {
            name: '🗡️ AnimeWorld',
            title: 'AnimeWorld • Multi-Audio 1080p',
            url: streamData.url,
            quality: '1080p',
            headers: {
              Referer: PLAYER + '/',
              Origin: PLAYER,
              'User-Agent': UA,
              Connection: 'keep-alive',
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
