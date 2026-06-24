window.dogMatchData = {
  notificationArchitecture: {
    enabled: false,
    futureTriggers: [
      "favoriteFriendScheduled",
      "compatiblePlayGroupAvailable",
      "regularDogReturning",
    ],
    contactChannels: ["email", "sms"],
  },
  profiles: [
    {
      id: "budders",
      name: "Budders",
      breed: "Small mixed breed",
      age: "Adult",
      size: "Small",
      energyLevel: 2,
      photos: ["assets/gallery-budders.jpeg"],
      personality: {
        en: "Gentle, observant, and happiest with calm companionship.",
        es: "Dulce, observador y feliz con compañía tranquila.",
      },
      playStyle: {
        en: "Soft social time, short yard walks, and cozy breaks.",
        es: "Momentos sociales suaves, caminatas cortas en el patio y descansos cómodos.",
      },
      favoriteActivities: {
        en: ["Slow introductions", "Sun patches", "Quiet check-ins"],
        es: ["Presentaciones tranquilas", "Ratitos al sol", "Acompañamiento suave"],
      },
      compatibilityNotes: {
        en: "Best with small or medium dogs who respect space and prefer gentle play.",
        es: "Ideal con perros pequeños o medianos que respetan el espacio y prefieren juego suave.",
      },
      bestFriends: ["Murci", "Poolside Guest"],
      carlaObservations: {
        en: "Budders relaxes quickly when introductions are slow and the group energy stays soft.",
        es: "Budders se relaja rápido cuando las presentaciones son lentas y la energía del grupo se mantiene suave.",
      },
      recommendedWith: ["murci", "poolside-guest"],
    },
    {
      id: "poolside-guest",
      name: "Poolside Guest",
      breed: "Mixed breed",
      age: "Adult",
      size: "Medium",
      energyLevel: 3,
      photos: ["assets/gallery-pool-dogs.jpeg"],
      personality: {
        en: "Relaxed, observant, and comfortable in the outdoor routine.",
        es: "Relajado, observador y cómodo dentro de la rutina al aire libre.",
      },
      playStyle: {
        en: "Calm poolside breaks, gentle greetings, and supervised yard time.",
        es: "Descansos tranquilos junto a la pileta, saludos suaves y patio supervisado.",
      },
      favoriteActivities: {
        en: ["Poolside resting", "Raised beds", "Quiet yard time"],
        es: ["Descansar junto a la pileta", "Camitas elevadas", "Patio tranquilo"],
      },
      compatibilityNotes: {
        en: "Pairs well with dogs who can enjoy being nearby without pushing constant play.",
        es: "Compatible con perros que disfrutan estar cerca sin buscar juego constante.",
      },
      bestFriends: ["Budders", "Pool Crew"],
      carlaObservations: {
        en: "This guest shows the value of giving dogs space to rest near the activity instead of forcing interaction.",
        es: "Este huésped muestra el valor de darles espacio para descansar cerca de la actividad sin forzar interacción.",
      },
      recommendedWith: ["budders", "pool-crew"],
    },
    {
      id: "murci",
      name: "Murci",
      breed: "Chihuahua mix",
      age: "Senior",
      size: "Small",
      energyLevel: 1,
      photos: ["assets/murci-resident-host.png"],
      personality: {
        en: "Tender, wise, and deeply bonded with trusted people.",
        es: "Tierno, sabio y muy conectado con las personas de confianza.",
      },
      playStyle: {
        en: "Quiet companionship and calm observation more than active play.",
        es: "Compañía tranquila y observación calma más que juego activo.",
      },
      favoriteActivities: {
        en: ["Being held", "Quiet rooms", "Gentle dogs nearby"],
        es: ["Estar en brazos", "Ambientes tranquilos", "Perros suaves cerca"],
      },
      compatibilityNotes: {
        en: "Best with very gentle dogs and low-energy guests who understand small-dog boundaries.",
        es: "Ideal con perros muy suaves y huéspedes de baja energía que respetan límites de perros pequeños.",
      },
      bestFriends: ["Budders"],
      carlaObservations: {
        en: "Murci helps show which dogs can stay calm and respectful around tiny companions.",
        es: "Murci ayuda a observar qué perros pueden mantenerse tranquilos y respetuosos con compañeros pequeños.",
      },
      recommendedWith: ["budders"],
    },
    {
      id: "pool-crew",
      name: "Pool Crew",
      breed: "Mixed small guests",
      age: "Adult",
      size: "Small to medium",
      energyLevel: 4,
      photos: ["assets/pool-time-featured.png"],
      personality: {
        en: "Social, sunny, and playful when the day includes water and yard time.",
        es: "Sociables, alegres y juguetones cuando el día incluye agua y patio.",
      },
      playStyle: {
        en: "Playful poolside movement with breaks between bursts of energy.",
        es: "Juego activo junto a la pileta con descansos entre momentos de energía.",
      },
      favoriteActivities: {
        en: ["Pool watching", "Yard exploring", "Small-group play"],
        es: ["Mirar la pileta", "Explorar el patio", "Juego en grupos pequeños"],
      },
      compatibilityNotes: {
        en: "Best with playful dogs who enjoy outdoor time but can settle when guided.",
        es: "Ideal con perros juguetones que disfrutan estar afuera y pueden calmarse con guía.",
      },
      bestFriends: ["Poolside Guest", "Yard Friends"],
      carlaObservations: {
        en: "This group shows how much better play feels when dogs have space, supervision, and natural breaks.",
        es: "Este grupo muestra cómo el juego mejora cuando los perros tienen espacio, supervisión y pausas naturales.",
      },
      recommendedWith: ["poolside-guest", "yard-friends"],
    },
    {
      id: "yard-friends",
      name: "Yard Friends",
      breed: "Mixed guests",
      age: "Adult",
      size: "Medium",
      energyLevel: 4,
      photos: ["assets/hero-pool.jpeg"],
      personality: {
        en: "Curious, active, and happiest with room to move.",
        es: "Curiosos, activos y felices con espacio para moverse.",
      },
      playStyle: {
        en: "Open-yard play, chase games, and supervised social movement.",
        es: "Juego en patio abierto, carreras y movimiento social supervisado.",
      },
      favoriteActivities: {
        en: ["Running", "Exploring", "Group play"],
        es: ["Correr", "Explorar", "Juego grupal"],
      },
      compatibilityNotes: {
        en: "Good match for dogs with medium-high energy who enjoy friendly movement without pressure.",
        es: "Buen match para perros de energía media-alta que disfrutan movimiento amistoso sin presión.",
      },
      bestFriends: ["Pool Crew"],
      carlaObservations: {
        en: "Yard friends need space, water breaks, and watchful matching so excitement stays healthy.",
        es: "Los amigos de patio necesitan espacio, pausas de agua y matching atento para que la emoción se mantenga sana.",
      },
      recommendedWith: ["pool-crew"],
    },
  ],
  upcomingStays: [
    {
      dogId: "budders",
      startDate: "2026-06-21",
      endDate: "2026-06-23",
      stayType: "Daycare",
    },
    {
      dogId: "murci",
      startDate: "2026-06-21",
      endDate: "2026-06-22",
      stayType: "Daycare",
    },
    {
      dogId: "pool-crew",
      startDate: "2026-06-24",
      endDate: "2026-06-26",
      stayType: "Boarding",
    },
    {
      dogId: "poolside-guest",
      startDate: "2026-06-25",
      endDate: "2026-06-27",
      stayType: "Boarding",
    },
    {
      dogId: "yard-friends",
      startDate: "2026-06-25",
      endDate: "2026-06-26",
      stayType: "Daycare",
    },
  ],
};
