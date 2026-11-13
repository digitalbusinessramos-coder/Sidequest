// Photos from Wikimedia Commons (resized, otherwise unchanged). Credits are shown in the app wherever a photo appears and in the City Guide.
export const PHOTOS = [
  {
    "key": "canteras",
    "src": "/photos/canteras.jpg",
    "alt": "Las Canteras beach at dusk",
    "author": "Nicolas Vigier",
    "license": "CC0",
    "license_url": "https://creativecommons.org/publicdomain/zero/1.0/deed.en",
    "source": "https://commons.wikimedia.org/wiki/File:Playa_de_las_Canteras,_Las_Palmas_de_Gran_Canaria_-_51605256627.jpg"
  },
  {
    "key": "vegueta",
    "src": "/photos/vegueta.jpg",
    "alt": "Street in Vegueta, the old town",
    "author": "Bengt Nyman",
    "license": "CC BY-SA 4.0",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0",
    "source": "https://commons.wikimedia.org/wiki/File:Vegueta_2016_02.jpg"
  },
  {
    "key": "cathedral",
    "src": "/photos/cathedral.jpg",
    "alt": "Santa Ana Cathedral, Vegueta",
    "author": "Gerda Arendt",
    "license": "CC BY-SA 4.0",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0",
    "source": "https://commons.wikimedia.org/wiki/File:Catedral_de_Santa_Ana,_Las_Palmas,_Gran_Canaria.jpg"
  },
  {
    "key": "roque",
    "src": "/photos/roque.jpg",
    "alt": "Roque Nublo at sunset",
    "author": "Rvr",
    "license": "CC BY-SA 4.0",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0",
    "source": "https://commons.wikimedia.org/wiki/File:Roque_Nublo_-_Gran_Canaria_01.jpg"
  },
  {
    "key": "dunes",
    "src": "/photos/dunes.jpg",
    "alt": "Maspalomas dunes",
    "author": "Marcela Střelcová",
    "license": "CC BY-SA 4.0",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0",
    "source": "https://commons.wikimedia.org/wiki/File:Dunas_de_Maspalomas,_Gran_Canaria.jpg"
  },
  {
    "key": "auditorio",
    "src": "/photos/auditorio.jpg",
    "alt": "Auditorio Alfredo Kraus, Las Canteras",
    "author": "Pepelopex",
    "license": "CC BY-SA 3.0",
    "license_url": "https://creativecommons.org/licenses/by-sa/3.0/",
    "source": "https://commons.wikimedia.org/wiki/File:Auditorio_alfredo_kraus_las_palmas_de_gran_canaria.jpg"
  },
  {
    "key": "alcaravaneras",
    "src": "/photos/alcaravaneras.jpg",
    "alt": "Beach volleyball at Las Alcaravaneras",
    "author": "Bengt Nyman",
    "license": "CC BY-SA 4.0",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0",
    "source": "https://commons.wikimedia.org/wiki/File:Playa_de_Las_Alcaravaneras.jpg"
  },
  {
    "key": "bandama",
    "src": "/photos/bandama.jpg",
    "alt": "Bandama Caldera",
    "author": "Martin Falbisoner",
    "license": "CC BY-SA 4.0",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0",
    "source": "https://commons.wikimedia.org/wiki/File:Bandama_Caldera,_Gran_Canaria,_May_2018.jpg"
  },
  {
    "key": "colon",
    "src": "/photos/colon.jpg",
    "alt": "Doorway of the Casa de Colón museum",
    "author": "H. Zell",
    "license": "CC BY-SA 3.0",
    "license_url": "https://creativecommons.org/licenses/by-sa/3.0",
    "source": "https://commons.wikimedia.org/wiki/File:Portal_Casa_de_Colon_01.jpg"
  },
  {
    "key": "confital",
    "src": "/photos/confital.jpg",
    "alt": "Waves at El Confital",
    "author": "Bengt Nyman",
    "license": "CC BY 2.0",
    "license_url": "https://creativecommons.org/licenses/by/2.0",
    "source": "https://commons.wikimedia.org/wiki/File:El_Confital_EM1B8915_(27788250179).jpg"
  },
  {
    "key": "mercado",
    "src": "/photos/mercado.jpg",
    "alt": "Vegueta market",
    "author": "Odynny",
    "license": "Public domain",
    "license_url": "https://commons.wikimedia.org/wiki/File:Mercado_de_Vegueta.jpg",
    "source": "https://commons.wikimedia.org/wiki/File:Mercado_de_Vegueta.jpg"
  },
  {
    "key": "promenade",
    "src": "/photos/promenade.jpg",
    "alt": "The Las Canteras promenade",
    "author": "Matthias Bethke",
    "license": "CC BY-SA 4.0",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0",
    "source": "https://commons.wikimedia.org/wiki/File:20150209_Strandleben_am_Paseo_des_Las_Canteras.jpg"
  },
  {
    "key": "santacatalina",
    "src": "/photos/santacatalina.jpg",
    "alt": "Live music in Santa Catalina",
    "author": "Bengt Nyman",
    "license": "CC BY 2.0",
    "license_url": "https://creativecommons.org/licenses/by/2.0",
    "source": "https://commons.wikimedia.org/wiki/File:Catalina_NZ7_9328_(49227579971).jpg"
  }
];
export const photo = (key) => PHOTOS.find((p) => p.key === key);

/** A fitting city photo for each kind of plan, so cards are not just icons. */
export const CATEGORY_PHOTO = {
  beach: 'canteras', surf: 'confital', sports: 'alcaravaneras', hiking: 'roque', daytrip: 'bandama', museum: 'colon',
  culture: 'santacatalina', coffee: 'promenade', food: 'mercado', study: 'vegueta', nightout: 'auditorio', wellness: 'dunes',
  games: 'vegueta', shopping: 'mercado', photo: 'cathedral', other: 'canteras',
};
export const photoFor = (category) => photo(CATEGORY_PHOTO[category] || 'canteras');

/** Pictures on the example marketplace listings (files in public/photos/market). */
export const MARKET_PHOTOS = [
  { key: 'p_book', alt: 'Stack of books', author: 'Alexander Grey', license: 'CC0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.en', source: 'https://commons.wikimedia.org/wiki/File:Stack_of_multicolored_books_on_a_table.jpg' },
  { key: 'p_wetsuit', alt: 'Wetsuit', author: 'Austin Neill', license: 'CC0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/deed.en', source: 'https://commons.wikimedia.org/wiki/File:Man_in_wetsuit_(Unsplash).jpg' },
  { key: 'p_fan', alt: 'Desk fan', author: 'Melissa Highton', license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0', source: 'https://commons.wikimedia.org/wiki/File:Desk_fan_GE_(2).jpg' },
  { key: 'p_bike', alt: 'City bike', author: 'Petar Milošević', license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0', source: 'https://commons.wikimedia.org/wiki/File:Dutch_bicycle.jpg' },
];
