const artwork = (name) => `/art/${name}.webp`

export const albums = [
  {
    id: 'midnight-bloom', title: 'Midnight Bloom', artist: 'The Lunar Keys', year: 2024,
    genre: 'Electronic', mood: 'Dream Pop', format: 'FLAC', size: '412 MB', art: artwork('midnight-bloom'),
    description: 'Soft synths, quiet streets, and the moments that stay with you after dark.',
    tracks: [
      ['Midnight Bloom', '4:12', '42 MB'], ['Paper Planes', '3:55', '38 MB'],
      ['Hollow Light', '5:21', '54 MB'], ['Beneath the Surface', '4:03', '41 MB'],
      ['Lost in Blue', '4:47', '48 MB'], ['Silver Morning', '3:36', '36 MB'],
      ['The Quiet Between', '5:02', '51 MB'], ['Canvas Skies', '4:18', '43 MB'],
      ['Fade to You', '3:49', '39 MB'], ['Midnight (Reprise)', '6:11', '60 MB'],
    ],
  },
  {
    id: 'a-brighter-tomorrow', title: 'A Brighter Tomorrow', artist: 'The Velvet Line', year: 2023,
    genre: 'Indie', mood: 'Ambient', format: 'FLAC', size: '386 MB', art: artwork('desert-sun'),
    description: 'Wide open landscapes and warm melodies for the road ahead.',
    tracks: [['First Light', '4:20', '43 MB'], ['Golden Hour', '3:58', '40 MB'], ['The Long Way Home', '5:16', '53 MB'], ['Tomorrow Comes', '4:44', '47 MB'], ['Open Skies', '5:08', '52 MB']],
  },
  {
    id: 'echoes-in-static', title: 'Echoes in Static', artist: 'Nora Skye', year: 2024,
    genre: 'Electronic', mood: 'Alternative', format: 'FLAC', size: '438 MB', art: artwork('echoes-in-static'),
    description: 'A restless, cinematic collection of songs about signal and distance.',
    tracks: [['Frequency', '3:56', '40 MB'], ['Echoes in Static', '4:42', '48 MB'], ['Afterimage', '5:11', '52 MB'], ['Low Tide', '4:06', '41 MB'], ['Close to Home', '4:39', '47 MB']],
  },
  {
    id: 'northern-skies', title: 'Northern Skies', artist: 'Ian Hollis', year: 2023,
    genre: 'Ambient', mood: 'Instrumental', format: 'FLAC', size: '521 MB', art: artwork('northern-skies'),
    description: 'Slow, expansive instrumentals inspired by winter nights.',
    tracks: [['Pines', '6:12', '63 MB'], ['Aurora', '5:36', '57 MB'], ['Northbound', '4:48', '49 MB'], ['White Silence', '7:04', '72 MB'], ['Before Dawn', '5:55', '60 MB']],
  },
  {
    id: 'quiet-machines', title: 'Quiet Machines', artist: 'Solar Drift', year: 2022,
    genre: 'Electronic', mood: 'Downtempo', format: 'FLAC', size: '397 MB', art: artwork('quiet-machines'),
    description: 'Precise rhythms and glowing textures from another orbit.',
    tracks: [['Circuit', '4:14', '42 MB'], ['Quiet Machines', '5:03', '51 MB'], ['Glass Memory', '4:32', '46 MB'], ['Half-Life', '5:28', '55 MB'], ['Signal Home', '6:01', '61 MB']],
  },
  {
    id: 'tides', title: 'Tides', artist: 'Marrow & Pine', year: 2021,
    genre: 'Indie', mood: 'Folk', format: 'FLAC', size: '364 MB', art: artwork('tides'),
    description: 'Salt air, distant shores, and stories told by the sea.',
    tracks: [['Low Water', '3:51', '39 MB'], ['Tides', '4:33', '46 MB'], ['Salt & Stone', '4:08', '42 MB'], ['Far From Here', '5:12', '53 MB'], ['Homeward', '4:28', '45 MB']],
  },
]

export const getMockAlbum = (id) => albums.find((album) => album.id === id)
