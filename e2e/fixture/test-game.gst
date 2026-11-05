<?xml version="1.0" encoding="UTF-8"?>
<gameSystem id="game" name="Test Game" revision="1">
  <costTypes>
    <costType id="pts" name="pts" defaultCostLimit="2000"/>
  </costTypes>
  <categoryEntries>
    <categoryEntry id="hq" name="HQ"/>
  </categoryEntries>
  <forceEntries>
    <forceEntry id="detachment" name="Detachment">
      <categoryLinks>
        <categoryLink id="detachment-hq" name="HQ" targetId="hq"/>
      </categoryLinks>
    </forceEntry>
  </forceEntries>
</gameSystem>
