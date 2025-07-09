# Bestiary of Sigillum - Interactive Hero Network Visualization

An interactive network visualization of heroes and their connections from the Bestiary of Sigillum fantasy game. Explore character relationships, abilities, and labels through an intuitive graph interface.

## About

This project visualizes the complete character database from the Bestiary of Sigillum game using an interactive network graph. Each hero is connected to their associated labels (Combat, Magic, Movement, etc.), creating a web of relationships that reveals patterns and connections between characters.

**This is unofficial fan work.** All rights to the original Bestiary of Sigillum game belong to [Intaglyph](https://www.intaglyph.ru).

## Features

- **Interactive Network Graph**: Pan, zoom, and explore character connections
- **Smart Search**: Find heroes and labels instantly by typing
- **Category Filtering**: Click legend items to filter by node types
- **Character Details**: View hero abilities, vitality, and connected labels
- **Mobile Responsive**: Optimized for both desktop and mobile devices
- **Medieval Theme**: Authentic fantasy game aesthetic with magical animations

## Getting Started for running locally

### Prerequisites

- Modern web browser with JavaScript enabled
- Local web server (for file loading - see below)

### Installation

1. Clone or download this repository
2. Start a local web server in the project directory:

```bash
# Using Python 3
python -m http.server 8000

# Using Node.js
npx serve

# Using PHP
php -S localhost:8000
```

3. Open your browser and navigate to `http://localhost:8000`

### File Structure

```
bestiary_of_sigillum/
├── index.html                           # Main application
├── styles.css                          # Styling and theme
├── script.js                           # Application logic
├── bestiary_reference_cards.json       # Character data source
├── hero_images/                        # Character portraits
├── download_heroes.sh                  # Image download script
├── bestiary_of_sigillum_reference_cards.pdf # Taken from bgg
└── bestiary_reference_cards.md         # obtained from the pdf
```

## Development

### Data Source

The visualization uses `bestiary_reference_cards.json` as the primary data source. This structured JSON contains:

- Character names and IDs
- Vitality scores
- Core and support abilities
- Associated labels and categories

Source: https://boardgamegeek.com/filepage/266575/bestiary-of-sigillum-reference-cards

### Updating Hero Images

To download or update hero images:

```bash
bash download_heroes.sh
```

This script fetches images from bestiary.online with a respectful 0.5s delay between requests.

## Contributing

This is a fan project. Contributions welcome.

## License

This project is for educational and fan purposes only. The visualization code is available for learning and modification, but all game content belongs to Intaglyph.

**Game Rights**: Bestiary of Sigillum © [Intaglyph](https://www.intaglyph.ru)  
**Visualization**: © 2025 nraw
