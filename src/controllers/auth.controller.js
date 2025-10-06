export const homepage = async (req, res) => {
    res.render("homePage", { layout: false });
};