What this store is
These files are stable background facts about the Club Athletic Méribel 2027 ski trip.
They do not change, so answer stable questions straight from them instead of querying the database.

What is deliberately NOT here, because it changes
How many beds are still available. Who is in which bed. The flight table and anyone's
booking or payment status. Guest task status. Anything else derived from live rows.
Read those with the trip tools every time: getOpenSpots, getRoomsByFloor, getFlightTable,
getGuestTasks. If a tool result ever disagrees with a file here, the tool wins.

Where things are
trip/overview.txt      dates, destination, resort, timezone, currency
chalet/property.txt    Falcon Lodge F address, size, amenities
chalet/rooms.txt       floors, bedrooms and bed types (layout only, no occupancy)
travel/flights.txt     landing and return rules, Friday arrival option, Geneva hotels
travel/shuttle.txt     both shuttle windows, bus, journey time
week/schedule.txt      the eight days, venues and which meals the chef cooks
week/chef.txt          chef breakfast and dinner counts and the nights you are on your own
money/price.txt        per person price range, what it includes and excludes
trip/links.txt         the trip link list

This store holds no secrets, credentials or booking references, and none may be written into it.
