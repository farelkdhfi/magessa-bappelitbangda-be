const { supabase } = require("../../config/supabase");
const { uploadToSupabaseStorage } = require("../../utils/uploadSupabase");

const buatFeedbackBawahan = async (req, res) => {
    try {
        const { disposisiId } = req.params;
        const { notes, status, status_dari_bawahan } = req.body;
        const userId = req.user.id;

        // --- FIX: Ambil User & Join Jabatan ---
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select(`name, jabatan_id, jabatan:jabatan_id ( nama )`)
            .eq('id', userId)
            .single();

        if (userError || !userData) {
            return res.status(401).json({ error: 'Data user tidak ditemukan' });
        }

        const userJabatan = userData.jabatan?.nama; // String "Staff IT" dsb
        const userName = userData.name;
        // --------------------------------------

        console.log('Bawahan feedback request:', { 
            disposisiId, 
            userJabatan, // Cek log ini nanti
            status, 
            status_dari_bawahan 
        });

        // Validasi input
        if (!notes || notes.trim() === '') {
            return res.status(400).json({
                error: 'Notes/catatan feedback wajib diisi'
            });
        }

        if (!status || !['diproses', 'selesai'].includes(status)) {
            return res.status(400).json({
                error: 'Status disposisi wajib dipilih dan harus berupa "diproses" atau "selesai"'
            });
        }

        // Pastikan disposisi ada dan diteruskan ke user ini
        const { data: disposisi, error: disposisiError } = await supabase
            .from('disposisi')
            .select('id, diteruskan_kepada_user_id, perihal, created_by, surat_masuk_id, status, status_dari_bawahan, dari_user_id, dari_jabatan')
            .eq('id', disposisiId)
            .eq('diteruskan_kepada_user_id', userId)
            .single();

        if (disposisiError || !disposisi) {
            return res.status(404).json({
                error: 'Disposisi tidak ditemukan atau tidak diteruskan untuk Anda'
            });
        }

        // Cek apakah feedback sudah ada sebelumnya
        const { data: existingFeedback, error: checkError } = await supabase
            .from('feedback_disposisi')
            .select('id')
            .eq('disposisi_id', disposisiId)
            .eq('user_id', userId)
            .single();

        if (existingFeedback) {
            return res.status(400).json({
                error: 'Feedback untuk disposisi ini sudah dikirim sebelumnya'
            });
        }

        // Data feedback bawahan
        const feedbackData = {
            disposisi_id: disposisiId,
            surat_masuk_id: disposisi.surat_masuk_id,
            user_id: userId,
            user_jabatan: userJabatan, // Sekarang sudah string yang benar
            user_name: userName,
            notes: notes.trim(),
            created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
        };

        // Insert feedback bawahan
        const { data: feedbackResult, error: feedbackError } = await supabase
            .from('feedback_disposisi')
            .insert([feedbackData])
            .select()
            .single();

        if (feedbackError) {
            console.error('Error creating bawahan feedback:', feedbackError);
            return res.status(400).json({ error: feedbackError.message });
        }

        console.log('Feedback bawahan berhasil dibuat:', feedbackResult);

        // Upload files jika ada
        let fileCount = 0;
        if (req.files && req.files.length > 0) {
            const uploadPromises = req.files.map(file =>
                uploadToSupabaseStorage(file, 'feedback-bawahan', 'surat-photos')
            );

            try {
                const uploadResults = await Promise.all(uploadPromises);

                // Simpan data file ke database
                const fileData = uploadResults.map(result => ({
                    feedback_id: feedbackResult.id,
                    disposisi_id: disposisiId,
                    file_path: result.publicUrl,
                    file_filename: result.fileName,
                    file_original_name: result.originalName,
                    file_size: result.size,
                    file_type: result.mimetype,
                    storage_path: result.fileName,
                    created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
                }));

                const { error: fileError } = await supabase
                    .from('feedback_files')
                    .insert(fileData);

                if (fileError) {
                    // Rollback
                    await supabase.from('feedback_disposisi').delete().eq('id', feedbackResult.id);
                    const filesToDelete = uploadResults.map(r => r.fileName);
                    await supabase.storage.from('surat-photos').remove(filesToDelete);
                    return res.status(400).json({ error: 'Gagal menyimpan file: ' + fileError.message });
                }

                fileCount = req.files.length;
                console.log(`${fileCount} files uploaded successfully`);
            } catch (uploadError) {
                console.error('Upload error:', uploadError);
                await supabase.from('feedback_disposisi').delete().eq('id', feedbackResult.id);
                return res.status(400).json({ error: 'Gagal upload file: ' + uploadError.message });
            }
        }

        // Update status disposisi
        const { error: updateError } = await supabase
            .from('disposisi')
            .update({
                status: status,
                status_dari_bawahan: status_dari_bawahan,
                has_feedback: true
            })
            .eq('id', disposisiId);

        if (updateError) {
            console.error('Error updating disposisi status:', updateError);
            return res.status(500).json({ error: 'Gagal memperbarui status disposisi' });
        }

        console.log('Status disposisi dari bawahan diupdate menjadi:', status);

        // Insert ke disposisi_status_log
        const statusLogData = {
            disposisi_id: disposisiId,
            status: status,
            oleh_user_id: userId,
            // Log sekarang akan menampilkan nama jabatan yang benar
            keterangan: `Feedback dari bawahan: ${status} oleh ${userJabatan}`
        };

        const { error: logError } = await supabase
            .from('disposisi_status_log')
            .insert([statusLogData]);

        if (logError) {
            console.error('Error creating status log:', logError);
        }

        res.status(201).json({
            message: `Feedback berhasil dikirim dan status diupdate menjadi "${status}"`,
            data: {
                ...feedbackResult,
                status_dari_bawahan: status,
                file_count: fileCount,
                has_files: fileCount > 0
            }
        });

    } catch (error) {
        console.error('Server error in bawahan feedback creation:', error);
        res.status(500).json({ error: error.message });
    }
}

const getFeedbackBawahan = async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: feedback, error } = await supabase
            .from('feedback_disposisi')
            .select(`
            *,
            disposisi (
              id,
              perihal,
              sifat,
              dengan_hormat_harap,
              status,
              status_dari_bawahan,
              catatan_atasan,
              created_at
            ),
            feedback_files (
              id,
              file_original_name,
              file_size,
              file_type,
              file_path,
              storage_path
            )
          `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching bawahan feedback:', error);
            return res.status(400).json({ error: error.message });
        }

        // Transform data dengan file info
        const transformedData = feedback?.map(item => {
            const files = item.feedback_files?.map(file => {
                let fileUrl = `/api/bawahan/feedback/file/${file.id}`;

                if (file.file_path && file.file_path.startsWith('http')) {
                    fileUrl = file.file_path;
                } else if (file.storage_path) {
                    const { data: { publicUrl } } = supabase.storage
                        .from('surat-photos')
                        .getPublicUrl(file.storage_path);
                    fileUrl = publicUrl;
                }

                return {
                    id: file.id,
                    filename: file.file_original_name,
                    size: file.file_size,
                    type: file.file_type,
                    url: fileUrl
                };
            }) || [];

            return {
                ...item,
                files,
                file_count: files.length,
                has_files: files.length > 0
            };
        }) || [];

        res.json({
            message: 'Berhasil mengambil feedback bawahan',
            data: transformedData,
            total: transformedData.length
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
}

const getFileFeedbackBawahan = async (req, res) => {
    try {
        const { fileId } = req.params;
        const userId = req.user.id;

        // Pastikan file milik user yang request melalui feedback_disposisi
        const { data: file, error } = await supabase
            .from('feedback_files')
            .select(`
            *,
            feedback_disposisi!inner (
              user_id
            )
          `)
            .eq('id', fileId)
            .eq('feedback_disposisi.user_id', userId)
            .single();

        if (error || !file) {
            return res.status(404).json({ error: 'File tidak ditemukan atau tidak ada akses' });
        }

        // Generate URL
        if (file.file_path && file.file_path.startsWith('http')) {
            return res.redirect(file.file_path);
        }

        if (file.storage_path) {
            const { data: { publicUrl }, error: urlError } = supabase.storage
                .from('surat-photos')
                .getPublicUrl(file.storage_path);

            if (!urlError) {
                return res.redirect(publicUrl);
            }
        }

        return res.status(404).json({ error: 'File tidak dapat diakses' });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

const getEditFeedbackBawahan = async (req, res) => {
    try {
        const { feedbackId } = req.params;
        const userId = req.user.id;

        // --- DEBUGGING LOG (Wajib cek terminal jika masih error) ---
        console.log('--- DEBUG EDIT VIEW BAWAHAN ---');
        console.log('Feedback ID:', feedbackId);
        console.log('User ID Login:', userId);
        // ---------------------------------------------------------

        // Ambil detail feedback 
        // HAPUS filter .eq('user_jabatan', ...) agar data lama yg jabatannya null tetap bisa diedit
        const { data: feedback, error } = await supabase
            .from('feedback_disposisi')
            .select(`
                *,
                disposisi (
                  id,
                  perihal,
                  sifat,
                  disposisi_kepada_jabatan,
                  dengan_hormat_harap,
                  created_at,
                  status,
                  status_dari_bawahan,
                  catatan_atasan,
                  surat_masuk (
                    id,
                    keterangan
                  )
                ),
                feedback_files (
                  id,
                  file_original_name,
                  file_size,
                  file_type,
                  file_path,
                  storage_path
                )
            `)
            .eq('id', feedbackId)
            .eq('user_id', userId) // Cukup validasi User ID saja (Security sudah aman)
            .single();

        if (error || !feedback) {
            console.error('Error DB / Not Found:', error);
            return res.status(404).json({
                error: 'Feedback tidak ditemukan atau Anda tidak memiliki akses'
            });
        }

        // Transform file data
        const files = feedback.feedback_files?.map(file => {
            let fileUrl = `/api/v1/feedback-disposisi/bawahan/${file.id}`; // Sesuaikan path jika perlu

            if (file.file_path && file.file_path.startsWith('http')) {
                fileUrl = file.file_path;
            } else if (file.storage_path) {
                const { data: { publicUrl } } = supabase.storage
                    .from('surat-photos')
                    .getPublicUrl(file.storage_path);
                fileUrl = publicUrl;
            }

            return {
                id: file.id,
                filename: file.file_original_name,
                size: file.file_size,
                type: file.file_type,
                url: fileUrl
            };
        }) || [];

        const responseData = {
            ...feedback,
            files,
            file_count: files.length,
            has_files: files.length > 0
        };

        res.json({
            message: 'Berhasil mengambil detail feedback untuk edit',
            data: responseData
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
}

const editFeedbackBawahan = async (req, res) => {
    try {
        const { feedbackId } = req.params;
        const { notes, status, status_dari_bawahan, remove_file_ids } = req.body;
        const userId = req.user.id;

        // 1. Ambil User & Join Jabatan (Untuk Update Data nanti)
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select(`name, jabatan_id, jabatan:jabatan_id ( nama )`)
            .eq('id', userId)
            .single();

        if (userError || !userData) {
            return res.status(401).json({ error: 'Data user tidak ditemukan' });
        }
        const userJabatan = userData.jabatan?.nama;
        // --------------------------------------

        console.log('Edit bawahan feedback request:', {
            feedbackId,
            userJabatan, // Ini jabatan yang BENAR
            status
        });

        // Validasi input
        if (!notes || notes.trim() === '') {
            return res.status(400).json({ error: 'Notes/catatan feedback wajib diisi' });
        }

        if (!status || !['diproses', 'selesai'].includes(status)) {
            return res.status(400).json({ error: 'Status disposisi wajib dipilih' });
        }

        // --- PERBAIKAN DI SINI ---
        // Hapus .eq('user_jabatan', ...) agar data lama yg bug tetap bisa diedit
        const { data: existingFeedback, error: feedbackError } = await supabase
            .from('feedback_disposisi')
            .select(`
                *,
                disposisi (
                  id,
                  perihal,
                  created_by,
                  surat_masuk_id,
                  diteruskan_kepada_user_id,
                  status,
                  status_dari_bawahan
                )
            `)
            .eq('id', feedbackId)
            .eq('user_id', userId) // Cukup validasi ID User saja
            .single();

        if (feedbackError || !existingFeedback) {
            return res.status(404).json({
                error: 'Feedback tidak ditemukan atau tidak ada akses untuk mengedit'
            });
        }

        // --- UPDATE DATA ---
        // Kita sekalian perbaiki data user_jabatan di database
        const updateData = {
            notes: notes.trim(),
            user_jabatan: userJabatan, // <--- UPDATE JABATAN BIAR FIX
            updated_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
        };

        const { data: updatedFeedback, error: updateError } = await supabase
            .from('feedback_disposisi')
            .update(updateData)
            .eq('id', feedbackId)
            .select()
            .single();

        if (updateError) {
            console.error('Error updating feedback:', updateError);
            return res.status(400).json({ error: updateError.message });
        }

        // Handle penghapusan file lama (sama seperti sebelumnya)
        let removedFileCount = 0;
        if (remove_file_ids) {
            try {
                const removeIds = Array.isArray(remove_file_ids) ? remove_file_ids : [remove_file_ids];

                const { data: filesToRemove, error: fetchError } = await supabase
                    .from('feedback_files')
                    .select('id, storage_path')
                    .eq('feedback_id', feedbackId)
                    .in('id', removeIds);

                if (!fetchError && filesToRemove && filesToRemove.length > 0) {
                    const storageFilesToDelete = filesToRemove
                        .filter(file => file.storage_path)
                        .map(file => file.storage_path);

                    if (storageFilesToDelete.length > 0) {
                        const { error: storageError } = await supabase.storage
                            .from('surat-photos')
                            .remove(storageFilesToDelete);
                    }

                    const { error: removeError } = await supabase
                        .from('feedback_files')
                        .delete()
                        .eq('feedback_id', feedbackId)
                        .in('id', removeIds);

                    if (!removeError) {
                        removedFileCount = filesToRemove.length;
                    }
                }
            } catch (removeError) {
                console.error('Error in file removal process:', removeError);
            }
        }

        // Upload file baru
        let newFileCount = 0;
        if (req.files && req.files.length > 0) {
            const uploadPromises = req.files.map(file =>
                uploadToSupabaseStorage(file, 'feedback-bawahan', 'surat-photos')
            );

            try {
                const uploadResults = await Promise.all(uploadPromises);

                const fileData = uploadResults.map(result => ({
                    feedback_id: feedbackId,
                    disposisi_id: existingFeedback.disposisi_id,
                    file_path: result.publicUrl,
                    file_filename: result.fileName,
                    file_original_name: result.originalName,
                    file_size: result.size,
                    file_type: result.mimetype,
                    storage_path: result.fileName,
                    created_at: new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).toISOString()
                }));

                const { error: fileError } = await supabase
                    .from('feedback_files')
                    .insert(fileData);

                if (fileError) {
                    const filesToDelete = uploadResults.map(r => r.fileName);
                    await supabase.storage.from('surat-photos').remove(filesToDelete);
                    return res.status(400).json({ error: 'Gagal menyimpan file baru: ' + fileError.message });
                }
                newFileCount = req.files.length;
            } catch (uploadError) {
                return res.status(400).json({ error: 'Gagal upload file baru: ' + uploadError.message });
            }
        }

        // Update status disposisi
        const { error: updateDisposisiError } = await supabase
            .from('disposisi')
            .update({
                status_dari_bawahan: status_dari_bawahan,
                status: status
            })
            .eq('id', existingFeedback.disposisi_id);

        if (updateDisposisiError) {
            console.error('Error updating disposisi status:', updateDisposisiError);
            return res.status(500).json({ error: 'Gagal memperbarui status disposisi' });
        }

        // Insert status log
        const statusLogData = {
            disposisi_id: existingFeedback.disposisi_id,
            status: status,
            oleh_user_id: userId,
            keterangan: `Update feedback bawahan: ${status} oleh ${userJabatan}`
        };

        const { error: logError } = await supabase
            .from('disposisi_status_log')
            .insert([statusLogData]);

        // Hitung total file
        const { data: remainingFiles } = await supabase
            .from('feedback_files')
            .select('id')
            .eq('feedback_id', feedbackId);

        const totalFiles = remainingFiles ? remainingFiles.length : 0;

        res.json({
            message: `Feedback berhasil diperbarui dan status diupdate menjadi "${status}"`,
            data: {
                ...updatedFeedback,
                status_dari_bawahan: status,
                file_count: totalFiles,
                has_files: totalFiles > 0
            }
        });

    } catch (error) {
        console.error('Server error in bawahan feedback update:', error);
        res.status(500).json({ error: error.message });
    }
}

module.exports = { 
    buatFeedbackBawahan, 
    getFeedbackBawahan, 
    getFileFeedbackBawahan, 
    getEditFeedbackBawahan, 
    editFeedbackBawahan 
}