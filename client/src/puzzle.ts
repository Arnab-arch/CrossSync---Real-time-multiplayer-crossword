export const puzzle = {
    rows: 5,
    cols: 5,
    layout: [
        ["C", "A", "T", "#", "#"],
        ["#", "#", "#", "#", "#"],
        ["D", "O", "G", "#", "#"],
        ["#", "#", "#", "#", "#"],
        ["#", "#", "#", "#", "#"],
    ],
    numbers: {
        "0-0": 1,
        "2-0": 2,
    } as Record<string, number>,
    clues: {
        across: [
            { number: 1, text: "A furry pet that says meow", answer: "CAT" },
            { number: 2, text: "A loyal pet that barks", answer: "DOG" },
        ],
        down: [] as { number: number; text: string; answer: string }[],
    },
};