const guestInstagrams: Record<string, string> = {
  Kaise: "https://www.instagram.com/kaise.white",
  "Amelia Drake": "https://www.instagram.com/ameliadrake33",
  "Kristy Kelly": "https://www.instagram.com/kristyke11y",
  "Kristy Khoury": "https://www.instagram.com/kristy.l.khoury",
  "Valeriia Stobolva": "https://www.instagram.com/valeriiastolbova",
  "Augustus Shewchuck": "https://www.instagram.com/ashewchuck",
  "Wayne Martindale": "https://www.instagram.com/_wayne.em_",
  "Olajuwon Jones": "https://www.instagram.com/juice_jones1",
  "Ted Delcima": "https://www.instagram.com/tedscorner_",
  "Christine Calvo": "https://www.instagram.com/christinecalvo_",
  "Christie Navarre": "https://www.instagram.com/xtnavarre",
};

export function guestInstagramUrl(displayName: string): string | undefined {
  return guestInstagrams[displayName];
}
