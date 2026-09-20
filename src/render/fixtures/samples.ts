/**
 * Sample drafts, one per pillar, written to the voice guide. They exist so the
 * render tests and the preview covers show what a real card looks like, and so
 * a designer can change the templates against believable text instead of lorem.
 * Nothing outside tests and previews should import this.
 */
import type { DraftText, Pillar } from "../../newsroom/types.js";

export const SAMPLES: Record<Pillar, DraftText> = {
  launches: {
    headline: "Starship flies again Tuesday night",
    slides: [
      {
        title: "Flight 12",
        body: "SpaceX is targeting Tue Sep 22, 6:10pm PT from Starbase, Texas, with a 60 minute window.",
      },
      {
        title: "What is new this time",
        body: "It is the second flight of the V3 upper stage and the first attempt to relight a Raptor after the coast phase.",
      },
      {
        title: "Where to watch",
        body: "SpaceX streams on X and YouTube from about 30 minutes before liftoff. Scrubs are common, so check before you sit down.",
      },
      {
        title: "Watch it with us",
        body: "If it slips past Tuesday we are putting the stream on the projector in room 512 at lunch. Everyone is welcome.",
      },
    ],
    caption:
      "Starship is scheduled to fly Tue Sep 22 at 6:10pm PT.\n\nThis is the second flight of the V3 upper stage, and the first one that tries to relight a Raptor in space after the coast phase. That relight is what an orbital refuelling mission would depend on, so it is the part worth watching.\n\nWatch live Tuesday 6:10pm PT on SpaceX's stream, or come to room 512 at lunch if the launch slips a day.\n\nSource: SpaceX, Launch Library 2.",
    sourceLine: "Source: SpaceX, Launch Library 2.",
    hashtags: ["rocketry", "lahs", "starship", "spacenews", "launch", "bayarea"],
    flags: ["launch times slip: confirm before posting"],
  },

  opportunities: {
    headline: "NASA's high school internship closes Oct 3",
    slides: [
      {
        title: "NASA OSTEM internships",
        body: "Applications for the spring session close Fri Oct 3, 11:59pm ET. One application is matched against every center, including Ames.",
      },
      {
        title: "Who can apply",
        body: "US citizens who are at least 16 on the first day, with a 3.0 GPA. Sophomores, juniors and seniors are all eligible.",
      },
      {
        title: "What you would do",
        body: "Past high school interns at Ames cleaned flight data, built test fixtures and wrote analysis code a real mission used.",
      },
      {
        title: "Start it this week",
        body: "Search NASA OSTEM, make an account, and ask a teacher for a recommendation now. Link in bio.",
      },
    ],
    caption:
      "NASA's spring OSTEM internship applications close Fri Oct 3, 11:59pm ET.\n\nIt is one application, matched against every NASA center, and Ames is 9 miles from campus. You need to be a US citizen, at least 16 on the first day, with a 3.0 GPA. High school interns there have cleaned flight data and built test hardware, not fetched coffee.\n\nRegistration closes Oct 3, link in bio. Ask a teacher for a recommendation this week.\n\nSource: NASA OSTEM internships.",
    sourceLine: "Source: NASA OSTEM internships.",
    hashtags: ["rocketry", "lahs", "internship", "nasa", "stemeducation", "bayarea"],
    flags: ["confirm eligibility rules before posting"],
  },

  explainer: {
    headline: "Specific impulse is a rocket's mpg",
    slides: [
      {
        title: "Start with a car",
        body: "A car that goes 40 miles on a gallon beats one that goes 20. An engine is rated the same way: how much push you get per unit of propellant.",
      },
      {
        title: "The number",
        body: "Specific impulse, or Isp, is measured in seconds. A Merlin vacuum engine is about 348 s. A hydrogen RL10 is about 465 s.",
      },
      {
        title: "Why seconds",
        body: "It is thrust divided by the weight of propellant burned each second, so the units cancel. One pound of propellant makes one pound of thrust for that long.",
      },
      {
        title: "Where the analogy breaks",
        body: "Higher Isp is not automatically better. Hydrogen scores high but needs huge cold tanks, so a denser kerosene stage often wins at liftoff.",
      },
    ],
    caption:
      "Specific impulse is the closest thing a rocket engine has to miles per gallon.\n\nIt is thrust divided by the weight of propellant burned per second, which is why it comes out in seconds. A Merlin vacuum engine sits around 348 s and a hydrogen RL10 around 465 s. The analogy breaks at the tank: hydrogen scores high on Isp but needs a huge, cold, heavy tank, so a denser kerosene stage often wins the first minute of flight.\n\nBring a question to Friday's meeting, room 512, and we will work an example on the board.\n\nSource: NASA Glenn Research Center, SpaceX.",
    sourceLine: "Source: NASA Glenn Research Center, SpaceX.",
    hashtags: ["rocketry", "lahs", "propulsion", "stemeducation", "explainer"],
    flags: [],
  },

  neighbors: {
    headline: "NASA Ames is 9 miles from campus",
    slides: [
      {
        title: "What Ames does",
        body: "The Mountain View center runs wind tunnels, small satellites and the airborne science program. It is about 20 minutes down 101.",
      },
      {
        title: "You can walk in",
        body: "The Ames Exploration Center is free and open to the public. It holds a flown Mercury capsule and a piece of the Moon.",
      },
      {
        title: "How to get in deeper",
        body: "Ames hosts school group tours and takes OSTEM interns every session. A teacher has to be the one who requests the tour.",
      },
      {
        title: "Tell us if you would come",
        body: "We are asking about a spring visit. Say so at Friday's meeting in room 512 and we will put your name down.",
      },
    ],
    caption:
      "The nearest NASA center is a 20 minute drive from campus.\n\nAmes runs wind tunnels, small satellite missions and the airborne science program, and its Exploration Center is free and open to the public with a flown Mercury capsule inside. School group tours exist, but a teacher has to request them.\n\nCome to Friday's meeting, room 512, if you would join a spring visit.\n\nSource: NASA Ames Research Center.",
    sourceLine: "Source: NASA Ames Research Center.",
    hashtags: ["rocketry", "lahs", "bayarea", "nasaames", "stemeducation"],
    flags: ["confirm public hours before posting"],
  },

  weekend: {
    headline: "Rockets fly at Snow Ranch on Saturday",
    slides: [
      {
        title: "LUNAR club launch",
        body: "Sat Sep 27, 9am to 3pm at Snow Ranch, near Farmington, about 2 hours from Los Altos. Watching costs nothing.",
      },
      {
        title: "What flies there",
        body: "Everything from A motors to high power certification flights. You can fly your own if it passes the range safety check that morning.",
      },
      {
        title: "What to bring",
        body: "Water, a hat, closed shoes. There is no shade, the grass is dry, and the nearest store is a long way off.",
      },
      {
        title: "Ride with us",
        body: "We are carpooling from the campus lot at 7am. Text an officer by Thursday if you want a seat.",
      },
    ],
    caption:
      "There is a club launch at Snow Ranch on Sat Sep 27, 9am to 3pm.\n\nSnow Ranch is near Farmington, about 2 hours from Los Altos, and LUNAR flies everything there from A motors up to high power certification attempts. Spectating is free and you can fly your own rocket if it passes the range safety check that morning.\n\nWe are carpooling from the campus lot at 7am. Text an officer by Thursday for a seat.\n\nSource: LUNAR launch schedule.",
    sourceLine: "Source: LUNAR launch schedule.",
    hashtags: ["rocketry", "lahs", "bayarea", "modelrocketry", "lunar", "weekend"],
    flags: ["confirm the launch is on before posting"],
  },

  club: {
    headline: "Our fin can held 180 pounds",
    slides: [
      {
        title: "What we tested",
        body: "The fin can took 180 pounds of static pull with no delamination. We expect about 90 pounds at max Q on the J motor flight.",
      },
      {
        title: "What we changed",
        body: "Two layers of glass on the tabs instead of one, and epoxy fillets left overnight instead of the two hours we used in March.",
      },
      {
        title: "What is next",
        body: "Motor mount bonding on Wednesday, then a full assembly weigh in before the October launch.",
      },
      {
        title: "Come build",
        body: "Room 512, Fridays at lunch. No experience needed and we will hand you a sanding block.",
      },
    ],
    caption:
      "Our fin can held 180 pounds in a static pull test on Wednesday.\n\nWe expect about 90 pounds of load at max Q on the J motor flight, so that is twice the margin we need. The change from March was two layers of glass on the fin tabs instead of one, and fillets left to cure overnight. Motor mount bonding is next.\n\nCome build with us Friday at lunch, room 512. No experience needed.\n\nSource: LAHS Rocket Club build log.",
    sourceLine: "Source: LAHS Rocket Club build log.",
    hashtags: ["rocketry", "lahs", "modelrocketry", "highpower", "buildlog"],
    flags: [],
  },

  review: {
    headline: "Three things that happened in space this week",
    slides: [
      {
        title: "Starship flew",
        body: "Flight 12 lifted off Tuesday from Starbase and completed the first Raptor relight after a coast phase.",
      },
      {
        title: "A NASA deadline opened",
        body: "Spring OSTEM internship applications opened and close Fri Oct 3, 11:59pm ET. Sixteen and up, 3.0 GPA.",
      },
      {
        title: "A neighbour launched",
        body: "LUNAR flew 74 rockets at Snow Ranch on Saturday, including two level two certification attempts.",
      },
      {
        title: "The takeaway",
        body: "Two of those three are things you can act on this month. Pick one and put it in your calendar today.",
      },
    ],
    caption:
      "Three things happened in space this week that matter to a high schooler here.\n\nStarship Flight 12 flew Tuesday and relit a Raptor after coasting, which is the manoeuvre orbital refuelling depends on. NASA's spring OSTEM internship applications opened and close Fri Oct 3. LUNAR flew 74 rockets at Snow Ranch on Saturday, two of them level two certification attempts.\n\nPick the one you can act on and put it in your calendar today.\n\nSource: SpaceX, NASA OSTEM, LUNAR.",
    sourceLine: "Source: SpaceX, NASA OSTEM, LUNAR.",
    hashtags: ["rocketry", "lahs", "spacenews", "weeklyreview", "bayarea"],
    flags: [],
  },
};
