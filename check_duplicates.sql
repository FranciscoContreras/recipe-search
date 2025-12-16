SELECT id, name, url, created_at 
FROM recipes 
WHERE name ILIKE '%strawberry-rhubarb crumble%'
ORDER BY created_at DESC;
