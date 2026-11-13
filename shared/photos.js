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
  }
];
export const photo = (key) => PHOTOS.find((p) => p.key === key);
