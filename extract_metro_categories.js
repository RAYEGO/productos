const fs = require('fs');

const menus = JSON.parse(fs.readFileSync('metro_menus.json', 'utf8'));
const categories = [];

function findCategories(obj) {
    if (!obj) return;
    
    if (obj.callToActionUrl && obj.subhead) {
        categories.push({
            name: obj.subhead,
            url: 'https://www.metro.pe' + obj.callToActionUrl
        });
    }

    if (obj.props && obj.props.callToActionUrl && obj.props.subhead) {
         categories.push({
            name: obj.props.subhead,
            url: 'https://www.metro.pe' + obj.props.callToActionUrl
        });
    }

    // Recursively search children/blocks if needed, but the structure seems flat in the relevant parts
    // Actually, the structure in the file is a map of keys to objects.
    // We can just iterate over the keys.
}

Object.values(menus).forEach(block => {
    findCategories(block);
    if (block.props) findCategories(block.props); // Sometimes props is inside
});

// Deduplicate
const uniqueCategories = Array.from(new Set(categories.map(c => c.url)))
    .map(url => categories.find(c => c.url === url));

console.log('Found categories:', uniqueCategories);
fs.writeFileSync('metro_main_categories.json', JSON.stringify(uniqueCategories, null, 2));
