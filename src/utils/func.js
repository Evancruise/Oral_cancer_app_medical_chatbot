import fs from 'fs-extra';
import path from 'path';
import logger from '#src/config/logger.js';

export async function deletefiles(Folder) {
    await fs.remove(Folder);
};

export const movefiles = async (sourceFolder, targetFolder) => {
    fs.readdir(sourceFolder, (err, files) => {
      if (err) {
        return false;
      }

      files.forEach(file => {
        const srcPath = path.join(sourceFolder, file);
        const destPath = path.join(targetFolder, file);

        fs.rename(srcPath, destPath, err => {
          if (err) console.error(`移動檔案失敗: ${file}`, err);
        });
      });
    });

    return true;
};