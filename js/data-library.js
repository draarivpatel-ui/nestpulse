/* NestPulse demo dataset: a labeled synthetic photo and file library manifest.
   Nothing here was scanned from a real disk. Every path, size, hash, and date was
   written by hand so the Tidy Plans panel has stable, inspectable input. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NestPulseLibrary = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const manifest = {
    synthetic: true,
    name: 'NestPulse demo library',
    note: 'Synthetic demo dataset generated for NestPulse. No real files were scanned.',
    items: [
      /* Beach burst b1. IMG_4021 was copied to Backups on the shoot date, then edited,
         so the edited original is the newest copy of the shared hash. */
      { id: 'p101', path: 'Photos/2024/07/IMG_4021.jpg', kind: 'photo', bytes: 3241201, modified: '2024-07-16', contentHash: 'dupb01', burstId: 'b1' },
      { id: 'p102', path: 'Photos/2024/07/IMG_4022.jpg', kind: 'photo', bytes: 3120884, modified: '2024-07-14', contentHash: '9f31c2aa', burstId: 'b1' },
      { id: 'p103', path: 'Photos/2024/07/IMG_4023.jpg', kind: 'photo', bytes: 2987440, modified: '2024-07-14', contentHash: '5c77d1e0', burstId: 'b1' },
      { id: 'p104', path: 'Photos/2024/07/IMG_4024.jpg', kind: 'photo', bytes: 3312589, modified: '2024-07-14', contentHash: '7ae4b91f', burstId: 'b1' },
      { id: 'p105', path: 'Backups/IMG_4021.jpg', kind: 'photo', bytes: 3241201, modified: '2024-07-14', contentHash: 'dupb01' },

      /* Birthday burst b2. */
      { id: 'p110', path: 'Photos/2024/09/IMG_4180.jpg', kind: 'photo', bytes: 3410882, modified: '2024-09-02', contentHash: 'a2d84c17', burstId: 'b2' },
      { id: 'p111', path: 'Photos/2024/09/IMG_4181.jpg', kind: 'photo', bytes: 3559001, modified: '2024-09-02', contentHash: '6b2f0d93', burstId: 'b2' },
      { id: 'p112', path: 'Photos/2024/09/IMG_4182.jpg', kind: 'photo', bytes: 3392410, modified: '2024-09-02', contentHash: 'e08c5a44', burstId: 'b2' },
      { id: 'p113', path: 'Photos/2024/09/IMG_4183.jpg', kind: 'photo', bytes: 3623119, modified: '2024-09-02', contentHash: '41fa7b26', burstId: 'b2' },
      { id: 'p114', path: 'Photos/2024/09/IMG_4184.jpg', kind: 'photo', bytes: 3488027, modified: '2024-09-02', contentHash: 'd90c1e58', burstId: 'b2' },

      /* Hike burst b3. DSC_0101 was copied into the Best album a day before a small edit. */
      { id: 'p120', path: 'Hikes/DSC_0101.jpg', kind: 'photo', bytes: 4102338, modified: '2024-10-20', contentHash: 'duph01', burstId: 'b3' },
      { id: 'p121', path: 'Hikes/DSC_0102.jpg', kind: 'photo', bytes: 3987112, modified: '2024-10-19', contentHash: 'cc5510de', burstId: 'b3' },
      { id: 'p122', path: 'Hikes/DSC_0103.jpg', kind: 'photo', bytes: 4231904, modified: '2024-10-19', contentHash: '8b09f3a1', burstId: 'b3' },
      { id: 'p123', path: 'Albums/Best/DSC_0101.jpg', kind: 'photo', bytes: 4102338, modified: '2024-10-19', contentHash: 'duph01' },

      /* Night city burst b4. */
      { id: 'p130', path: 'Photos/2025/01/PXL_20250111_201133.jpg', kind: 'photo', bytes: 4482910, modified: '2025-01-11', contentHash: '33d7a9c4', burstId: 'b4' },
      { id: 'p131', path: 'Photos/2025/01/PXL_20250111_201141.jpg', kind: 'photo', bytes: 4401822, modified: '2025-01-11', contentHash: '91c2d7e8', burstId: 'b4' },
      { id: 'p132', path: 'Photos/2025/01/PXL_20250111_201148.jpg', kind: 'photo', bytes: 4567230, modified: '2025-01-11', contentHash: 'f0a3b6d2', burstId: 'b4' },

      /* Exact duplicates: same bytes, same hash, different folders. */
      { id: 'v101', path: 'Videos/Drone Flight 2025-03-02.mp4', kind: 'video', bytes: 682011443, modified: '2025-03-03', contentHash: 'dupv01' },
      { id: 'v102', path: 'Archive/Drone Flight 2025-03-02.mp4', kind: 'video', bytes: 682011443, modified: '2025-03-01', contentHash: 'dupv01' },
      { id: 'd101', path: 'Documents/Tax 2025 Summary.pdf', kind: 'document', bytes: 812004, modified: '2025-06-30', contentHash: 'dupt01' },
      { id: 'd102', path: 'Archive/Tax 2025 Summary.pdf', kind: 'document', bytes: 812004, modified: '2025-06-01', contentHash: 'dupt01' },
      { id: 's101', path: 'Screenshots/Screenshot 2025-02-10 at 14.22.08.png', kind: 'screenshot', bytes: 1042881, modified: '2025-02-10', contentHash: 'dups01' },
      { id: 's102', path: 'Screenshots/Old/Screenshot 2025-02-10 at 14.22.08.png', kind: 'screenshot', bytes: 1042881, modified: '2025-02-09', contentHash: 'dups01' },

      /* Copy pattern pairs: same name and size, different hash, copy suffix. */
      { id: 'p140', path: 'Photos/2025/04/IMG_4300.jpg', kind: 'photo', bytes: 2100111, modified: '2025-04-19', contentHash: 'pat01' },
      { id: 'p141', path: 'Photos/2025/04/IMG_4300 (1).jpg', kind: 'photo', bytes: 2100111, modified: '2025-04-19', contentHash: 'pat02' },
      { id: 'd110', path: 'Documents/Recipes/recipe scan.pdf', kind: 'document', bytes: 1450032, modified: '2025-02-02', contentHash: 'pat03' },
      { id: 'd111', path: 'Documents/Recipes/recipe scan copy.pdf', kind: 'document', bytes: 1450032, modified: '2025-02-02', contentHash: 'pat04' },

      /* Standalone screenshots across the cutoff date. */
      { id: 's110', path: 'Screenshots/Screenshot 2023-03-11 at 09.15.42.png', kind: 'screenshot', bytes: 512004, modified: '2023-03-11', contentHash: 's001a' },
      { id: 's111', path: 'Screenshots/Screenshot 2023-08-21 at 18.40.11.png', kind: 'screenshot', bytes: 633410, modified: '2023-08-21', contentHash: 's001b' },
      { id: 's112', path: 'Screenshots/Screenshot 2024-02-02 at 11.02.55.png', kind: 'screenshot', bytes: 728940, modified: '2024-02-02', contentHash: 's001c' },
      { id: 's113', path: 'Screenshots/Screenshot 2024-09-14 at 20.11.03.png', kind: 'screenshot', bytes: 884102, modified: '2024-09-14', contentHash: 's001d' },
      { id: 's114', path: 'Screenshots/Screenshot 2025-05-30 at 08.55.19.png', kind: 'screenshot', bytes: 991877, modified: '2025-05-30', contentHash: 's001e' },

      /* Large single videos. */
      { id: 'v110', path: 'Videos/Holiday Montage 2024.mp4', kind: 'video', bytes: 2254854144, modified: '2024-12-28', contentHash: 'v001a' },
      { id: 'v111', path: 'Videos/Gameplay Clip.mp4', kind: 'video', bytes: 480311296, modified: '2025-02-15', contentHash: 'v001b' },
      { id: 'v112', path: 'Videos/Interview Take 3.mp4', kind: 'video', bytes: 1308850176, modified: '2025-04-08', contentHash: 'v001c' },

      /* Standalone documents. */
      { id: 'd120', path: 'Documents/Lease Renewal 2025.pdf', kind: 'document', bytes: 1204883, modified: '2025-08-01', contentHash: 'd001a' },
      { id: 'd121', path: 'Documents/Router Manual.pdf', kind: 'document', bytes: 6391004, modified: '2023-11-12', contentHash: 'd001b' },
      { id: 'd122', path: 'Documents/Insurance Card Scan.pdf', kind: 'document', bytes: 2405120, modified: '2024-05-04', contentHash: 'd001c' },
      { id: 'd123', path: 'Documents/Recipes/paneer tikka.pdf', kind: 'document', bytes: 904112, modified: '2025-01-20', contentHash: 'd001d' },

      /* Solo photos with no duplicates or burst neighbors. */
      { id: 'p150', path: 'Photos/2023/06/IMG_3011.jpg', kind: 'photo', bytes: 2890441, modified: '2023-06-10', contentHash: 'p001a' },
      { id: 'p151', path: 'Photos/2023/06/IMG_3012.jpg', kind: 'photo', bytes: 2755880, modified: '2023-06-10', contentHash: 'p001b' },
      { id: 'p152', path: 'Photos/2023/11/IMG_3340.jpg', kind: 'photo', bytes: 3120477, modified: '2023-11-05', contentHash: 'p001c' },
      { id: 'p153', path: 'Photos/2024/01/IMG_3502.jpg', kind: 'photo', bytes: 2988110, modified: '2024-01-15', contentHash: 'p001d' },
      { id: 'p154', path: 'Photos/2024/02/IMG_3618.jpg', kind: 'photo', bytes: 3311229, modified: '2024-02-18', contentHash: 'p001e' },
      { id: 'p155', path: 'Photos/2024/03/IMG_3701.jpg', kind: 'photo', bytes: 3055101, modified: '2024-03-09', contentHash: 'p001f' },
      { id: 'p156', path: 'Photos/2024/05/IMG_3890.jpg', kind: 'photo', bytes: 2899004, modified: '2024-05-25', contentHash: 'p001g' },
      { id: 'p157', path: 'Photos/2024/08/IMG_4088.jpg', kind: 'photo', bytes: 3442099, modified: '2024-08-17', contentHash: 'p001h' },
      { id: 'p158', path: 'Photos/2024/10/IMG_4210.jpg', kind: 'photo', bytes: 3188554, modified: '2024-10-06', contentHash: 'p001i' },
      { id: 'p159', path: 'Photos/2024/12/IMG_4377.jpg', kind: 'photo', bytes: 3522110, modified: '2024-12-25', contentHash: 'p001j' },
      { id: 'p160', path: 'Photos/2025/02/IMG_4412.jpg', kind: 'photo', bytes: 2912380, modified: '2025-02-14', contentHash: 'p001k' },
      { id: 'p161', path: 'Photos/2025/03/IMG_4468.jpg', kind: 'photo', bytes: 3277019, modified: '2025-03-21', contentHash: 'p001l' },
      { id: 'p162', path: 'Photos/2025/05/IMG_4520.jpg', kind: 'photo', bytes: 3099845, modified: '2025-05-04', contentHash: 'p001m' },
      { id: 'p163', path: 'Plants/monstera week 12.jpg', kind: 'photo', bytes: 2788102, modified: '2025-05-11', contentHash: 'p001n' },
      { id: 'p164', path: 'Plants/monstera week 20.jpg', kind: 'photo', bytes: 2944008, modified: '2025-07-06', contentHash: 'p001o' },
      { id: 'p165', path: 'Pets/deski napping.jpg', kind: 'photo', bytes: 3361229, modified: '2025-06-18', contentHash: 'p001p' },
      { id: 'p166', path: 'Desk/setup 2025 final.jpg', kind: 'photo', bytes: 4021884, modified: '2025-06-30', contentHash: 'p001q' },
      { id: 'p167', path: 'Photos/2025/08/IMG_4630.jpg', kind: 'photo', bytes: 3155002, modified: '2025-08-02', contentHash: 'p001r' },
    ],
  };

  return { manifest: manifest };
});
