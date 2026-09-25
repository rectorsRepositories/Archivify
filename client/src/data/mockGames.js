const artwork = (name) => `/art/${name}.webp`

export const games = [
  { id: 'elden-ring', title: 'Elden Ring', platform: 'PC', genre: 'RPG', year: 2022, size: '58.7 GB', art: artwork('elden-ring') },
  { id: 'red-frontier', title: 'Red Frontier', platform: 'PC', genre: 'Adventure', year: 2024, size: '42.6 GB', art: artwork('red-frontier') },
  { id: 'neon-riders', title: 'Neon Riders', platform: 'PlayStation', genre: 'Racing', year: 2023, size: '31.4 GB', art: artwork('neon-riders') },
  { id: 'shadow-realm', title: 'Shadow Realm', platform: 'PlayStation', genre: 'RPG', year: 2021, size: '44.2 GB', art: artwork('shadow-realm') },
  { id: 'starfall', title: 'Starfall', platform: 'Xbox', genre: 'Adventure', year: 2024, size: '68.3 GB', art: artwork('starfall') },
  { id: 'lost-temple', title: 'The Lost Temple', platform: 'Nintendo', genre: 'Adventure', year: 2020, size: '12.8 GB', art: artwork('lost-temple') },
]
